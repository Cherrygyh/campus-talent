import { readFile } from 'node:fs/promises';
import type { RegistrationRecord } from './registration-sync';

// Tencent's official MCP endpoint. Do not accept a caller-supplied endpoint or forward
// credentials through redirects: the personal token must only reach docs.qq.com.
const ENDPOINT = 'https://docs.qq.com/openapi/mcp';
const MAX_BYTES = 8 * 1024 * 1024;
type JsonObject = Record<string, unknown>;
export class TencentDocsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TencentDocsError';
  }
}
function object(value: unknown): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new TencentDocsError('腾讯文档返回的数据格式不完整，本次未修改名单');
  return value as JsonObject;
}

export class TencentDocsClient {
  private id = 0;
  private session = '';
  constructor(
    private token: string,
    private signal: AbortSignal,
    private request: typeof fetch = fetch,
  ) {}
  private async rpc(method: string, params: JsonObject = {}, notification = false) {
    const id = notification ? undefined : ++this.id;
    let response: Response;
    try {
      response = await this.request(ENDPOINT, {
        method: 'POST',
        redirect: 'error',
        signal: this.signal,
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          Authorization: this.token,
          'MCP-Protocol-Version': '2024-11-05',
          ...(this.session ? { 'Mcp-Session-Id': this.session } : {}),
        },
        body: JSON.stringify({ jsonrpc: '2.0', ...(id ? { id } : {}), method, params }),
      });
    } catch {
      throw new TencentDocsError('无法连接腾讯文档或请求超时，稍后会自动重试');
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      if (response.status === 401 || response.status === 403)
        throw new TencentDocsError('腾讯文档授权无效或无权读取该结果表，请更新服务器 Token');
      if (response.status === 429)
        throw new TencentDocsError('腾讯文档调用额度或频率受限，稍后会自动重试');
      throw new TencentDocsError(`腾讯文档暂时无法读取（HTTP ${response.status}）`);
    }
    this.session = response.headers.get('mcp-session-id') || this.session;
    if (notification) {
      await response.body?.cancel().catch(() => {});
      return {};
    }
    const reader = response.body?.getReader();
    if (!reader) throw new TencentDocsError('腾讯文档没有返回数据');
    const decoder = new TextDecoder();
    const sse = response.headers.get('content-type')?.includes('text/event-stream');
    let buffer = '';
    let size = 0;
    let result: JsonObject | undefined;
    try {
      while (!result) {
        const chunk = await reader.read();
        size += chunk.value?.byteLength || 0;
        if (size > MAX_BYTES) throw new TencentDocsError('腾讯文档返回内容过大，本次未修改名单');
        buffer += decoder.decode(chunk.value, { stream: !chunk.done });
        if (sse) {
          buffer = buffer.replace(/\r\n/g, '\n');
          let boundary: number;
          while ((boundary = buffer.indexOf('\n\n')) >= 0) {
            const event = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            const data = event
              .split('\n')
              .filter((line) => line.startsWith('data:'))
              .map((line) => line.slice(5).trimStart())
              .join('\n');
            if (!data) continue;
            const parsed = object(JSON.parse(data));
            if (parsed.id === id) result = parsed;
          }
        } else if (chunk.done) result = object(JSON.parse(buffer));
        if (chunk.done) break;
      }
    } catch (error) {
      if (error instanceof TencentDocsError) throw error;
      throw new TencentDocsError('腾讯文档响应中断或格式无效，本次未修改名单');
    } finally {
      await reader.cancel().catch(() => {});
    }
    if (!result || result.id !== id)
      throw new TencentDocsError('腾讯文档没有返回完整结果，本次未修改名单');
    if (result.error) throw new TencentDocsError('腾讯文档接口调用失败，请检查授权及文档权限');
    return object(result.result);
  }
  async initialize() {
    await this.rpc('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'campus-talent-sync', version: '1.1.0' },
    });
    await this.rpc('notifications/initialized', {}, true);
  }
  async listTools() {
    return this.rpc('tools/list');
  }
  async call(name: string, args: JsonObject) {
    const result = await this.rpc('tools/call', { name, arguments: args });
    if (result.isError)
      throw new TencentDocsError('腾讯文档读取失败，请检查 Token、文档权限或调用额度');
    if (result.structuredContent) {
      const content = object(result.structuredContent);
      if (content.error) throw new TencentDocsError('腾讯文档读取失败，请检查文档权限或调用额度');
      return content;
    }
    if (!Array.isArray(result.content)) throw new TencentDocsError('腾讯文档没有返回表格数据');
    const text = result.content
      .map((part: unknown) => object(part))
      .filter((part: JsonObject) => part.type === 'text')
      .map((part: JsonObject) => part.text)
      .join('\n');
    try {
      const content = object(JSON.parse(text));
      if (content.error) throw new TencentDocsError('腾讯文档读取失败，请检查文档权限或调用额度');
      return content;
    } catch {
      throw new TencentDocsError('腾讯文档返回的表格数据格式无法识别');
    }
  }
}

export async function tencentClient(tokenFile: string, signal: AbortSignal) {
  let token: string;
  try {
    token = (await readFile(tokenFile, 'utf8')).trim();
  } catch {
    throw new TencentDocsError('服务器未配置腾讯文档 Token');
  }
  if (!token || /[\r\n]/.test(token)) throw new TencentDocsError('服务器 Token 配置格式无效');
  const client = new TencentDocsClient(token, signal);
  await client.initialize();
  return client;
}

// Populated using the official SmartSheet MCP contract; field labels are matched
// after stripping Tencent Form's required marker, not by column position.
const normalizeTitle = (title: string) => title.replace(/\s|[（(]必填[）)]/g, '');
const REGISTRATION_TITLES = ['姓名', '班级', '学号', '电话', '邮箱', '自我介绍'];
function cellText(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (Array.isArray(value))
    return value
      .map((item) => {
        const part = object(item);
        if (typeof part.text !== 'string')
          throw new TencentDocsError('报名字段出现不支持的数据类型，本次未修改名单');
        return part.text;
      })
      .join('');
  throw new TencentDocsError('报名字段出现不支持的数据类型，本次未修改名单');
}

export function registrationFromValues(remoteId: string, values: JsonObject): RegistrationRecord {
  const fields = new Map<string, unknown>();
  for (const [label, value] of Object.entries(values)) {
    const normalized = normalizeTitle(label);
    if (fields.has(normalized)) throw new TencentDocsError('报名表存在重名字段，无法安全对应');
    fields.set(normalized, value);
  }
  for (const required of REGISTRATION_TITLES)
    if (!fields.has(required))
      throw new TencentDocsError(`报名表缺少“${required}”字段，本次未修改名单`);
  return {
    remoteId,
    name: cellText(fields.get('姓名')),
    className: cellText(fields.get('班级')),
    studentId: cellText(fields.get('学号')).trim().toUpperCase(),
    phone: cellText(fields.get('电话')),
    email: cellText(fields.get('邮箱')),
    extra: { 自我介绍: cellText(fields.get('自我介绍')) },
  };
}

export async function fetchTencentRegistrations(config: {
  fileId: string;
  sheetId: string;
  tokenFile: string;
}): Promise<RegistrationRecord[]> {
  const client = await tencentClient(config.tokenFile, AbortSignal.timeout(100_000));
  return fetchTencentRecords(client, config);
}

export async function fetchTencentRecords(
  client: Pick<TencentDocsClient, 'call'>,
  config: { fileId: string; sheetId: string },
): Promise<RegistrationRecord[]> {
  const source = { file_id: config.fileId, sheet_id: config.sheetId };
  const schema = await client.call('smartsheet.list_fields', { ...source, offset: 0, limit: 100 });
  if (schema.error) throw new TencentDocsError('腾讯文档字段读取失败，请检查文档权限或调用额度');
  if (!Array.isArray(schema.fields) || schema.has_more !== false)
    throw new TencentDocsError('报名表字段过多或结构不完整，本次未修改名单');
  const titles = schema.fields
    .map((value) => {
      const field = object(value);
      if (typeof field.field_title !== 'string') throw new TencentDocsError('报名表字段标题无效');
      return field.field_title;
    })
    .filter((title) => REGISTRATION_TITLES.includes(normalizeTitle(title)));
  if (
    titles.length !== REGISTRATION_TITLES.length ||
    new Set(titles.map(normalizeTitle)).size !== REGISTRATION_TITLES.length
  )
    throw new TencentDocsError(
      '报名表需要姓名、班级、学号、电话、邮箱和自我介绍六个字段，且不能重名',
    );
  const records: RegistrationRecord[] = [];
  // Contract verified through Tencent's official tools/list and the linked result
  // table. Only the six application fields are requested; submitter profiles stay
  // in Tencent Docs. Partial or changing pagination never reaches the database.
  let offset = 0;
  let total: number | undefined;
  while (true) {
    const data = await client.call('smartsheet.list_records', {
      ...source,
      field_titles: titles,
      offset,
      limit: 100,
    });
    if (data.error) throw new TencentDocsError('腾讯文档报名读取失败，请检查文档权限或调用额度');
    if (
      !Array.isArray(data.records) ||
      typeof data.has_more !== 'boolean' ||
      typeof data.total !== 'number' ||
      !Number.isSafeInteger(data.total) ||
      data.total < 0
    )
      throw new TencentDocsError('腾讯文档分页数据不完整，本次未修改名单');
    if (total !== undefined && total !== data.total)
      throw new TencentDocsError('腾讯文档报名正在变化，本次未修改名单，稍后会重新同步');
    total = data.total;
    if (total > 3000) throw new TencentDocsError('报名超过 3000 人，请先整理招新批次');
    for (const value of data.records) {
      const record = object(value);
      if (typeof record.record_id !== 'string' || !record.record_id)
        throw new TencentDocsError('腾讯文档记录缺少稳定编号，本次未修改名单');
      if (!Array.isArray(record.field_values))
        throw new TencentDocsError('腾讯文档报名字段不完整，本次未修改名单');
      const values: JsonObject = Object.fromEntries(titles.map((title) => [title, '']));
      const seen = new Set<string>();
      for (const fieldValue of record.field_values) {
        const field = object(fieldValue);
        if (typeof field.field !== 'string' || !titles.includes(field.field)) continue;
        if (seen.has(field.field)) throw new TencentDocsError('腾讯文档记录存在重名字段');
        seen.add(field.field);
        if (typeof field.string_value === 'string') values[field.field] = field.string_value;
        else if (field.text_value) values[field.field] = object(field.text_value).items;
        else throw new TencentDocsError('报名字段的数据类型已变化，本次未修改名单');
      }
      records.push(registrationFromValues(record.record_id, values));
    }
    if (records.length > 3000) throw new TencentDocsError('报名超过 3000 人，请先整理招新批次');
    if (!data.has_more) {
      if (records.length !== total)
        throw new TencentDocsError('腾讯文档分页结果有遗漏，本次未修改名单');
      if (new Set(records.map((record) => record.remoteId)).size !== records.length)
        throw new TencentDocsError('腾讯文档分页出现重复记录，本次未修改名单');
      return records;
    }
    if (
      !data.records.length ||
      typeof data.next !== 'number' ||
      !Number.isSafeInteger(data.next) ||
      data.next <= offset
    )
      throw new TencentDocsError('腾讯文档分页游标异常，本次未修改名单');
    offset = data.next;
  }
}
