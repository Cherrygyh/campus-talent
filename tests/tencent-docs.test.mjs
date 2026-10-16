import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const temporary = await mkdtemp(path.join(os.tmpdir(), 'campus-tencent-docs-'));
try {
  await build({
    entryPoints: ['lib/tencent-docs.ts'],
    outdir: temporary,
    outExtension: { '.js': '.mjs' },
    bundle: true,
    platform: 'node',
    format: 'esm',
  });
  const { TencentDocsClient, TencentDocsError, registrationFromValues, fetchTencentRecords } =
    await import(pathToFileURL(path.join(temporary, 'tencent-docs.mjs')).href);
  const token = 'fake_private_token_that_must_never_appear_in_errors';
  const privateData = 'fake_private_student_answers_that_must_not_appear_in_errors';
  const encoder = new TextEncoder();
  const jsonResponse = (id, result, init = {}) =>
    new Response(JSON.stringify({ jsonrpc: '2.0', id, result }), {
      ...init,
      headers: { 'Content-Type': 'application/json', ...init.headers },
    });
  const streamResponse = (chunks, options = {}) => {
    let index = 0;
    return new Response(
      new ReadableStream({
        pull(controller) {
          if (index < chunks.length) {
            const value = chunks[index++];
            controller.enqueue(typeof value === 'string' ? encoder.encode(value) : value);
          } else if (!options.keepOpen) controller.close();
        },
        cancel(reason) {
          return options.cancel?.(reason);
        },
      }),
      {
        status: options.status || 200,
        headers: { 'Content-Type': options.contentType || 'text/event-stream' },
      },
    );
  };
  const fakeClient = (handler, signal = new AbortController().signal) => {
    const requests = [];
    const client = new TencentDocsClient(token, signal, async (url, init) => {
      assert.equal(url, 'https://docs.qq.com/openapi/mcp', 'Token 只能发送到腾讯官方固定地址');
      assert.equal(init.method, 'POST');
      assert.equal(init.redirect, 'error', '不能通过重定向转发 Token');
      assert.equal(init.signal, signal);
      const headers = new Headers(init.headers);
      assert.equal(headers.get('Authorization'), token);
      assert.equal(headers.get('Accept'), 'application/json, text/event-stream');
      const body = JSON.parse(init.body);
      assert.equal(body.jsonrpc, '2.0');
      requests.push({ body, headers });
      return handler(body, headers, requests.length);
    });
    return { client, requests };
  };
  const safeFailure = async (work, expected) => {
    try {
      await work();
      assert.fail('本次读取应失败');
    } catch (error) {
      assert.ok(error instanceof TencentDocsError, '错误应转换为统一的腾讯文档业务错误');
      assert.match(error.message, expected);
      assert.equal(error.message.includes(token), false, '错误不能包含 Token');
      assert.equal(error.message.includes(privateData), false, '错误不能包含报名答卷');
      assert.equal(error.cause, undefined, '公开错误不能携带含敏感数据的原始 cause');
    }
  };

  const initialized = fakeClient((body, headers) => {
    if (body.method === 'initialize') {
      assert.equal(body.id, 1);
      assert.equal(body.params.protocolVersion, '2024-11-05');
      return jsonResponse(
        body.id,
        { protocolVersion: '2024-11-05', capabilities: {} },
        {
          headers: { 'Mcp-Session-Id': 'test-session' },
        },
      );
    }
    assert.equal(headers.get('Mcp-Session-Id'), 'test-session');
    if (body.method === 'notifications/initialized') {
      assert.equal('id' in body, false, '初始化通知不应占用请求编号');
      return new Response(null, { status: 202 });
    }
    assert.equal(body.method, 'tools/list');
    assert.equal(body.id, 2);
    return jsonResponse(body.id, { tools: [{ name: 'test.read' }] });
  });
  await initialized.client.initialize();
  assert.deepEqual(await initialized.client.listTools(), { tools: [{ name: 'test.read' }] });
  assert.equal(initialized.requests.length, 3);

  const structured = fakeClient((body) => {
    assert.equal(body.method, 'tools/call');
    assert.equal(body.params.name, 'test.read');
    assert.deepEqual(body.params.arguments, { file_id: 'file-1' });
    return jsonResponse(body.id, { structuredContent: { data: { records: [] } } });
  });
  assert.deepEqual(await structured.client.call('test.read', { file_id: 'file-1' }), {
    data: { records: [] },
  });
  const textContent = fakeClient((body) =>
    jsonResponse(body.id, {
      content: [
        { type: 'text', text: '{"data":' },
        { type: 'image', data: 'ignored-image' },
        { type: 'text', text: '{"records":[]}}' },
      ],
    }),
  );
  assert.deepEqual(await textContent.client.call('test.read', {}), { data: { records: [] } });

  const sse = fakeClient((body) =>
    streamResponse([
      'event: message\r\ndata: ' +
        JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { tools: [] } }) +
        '\r\n\r\n',
    ]),
  );
  assert.deepEqual(await sse.client.listTools(), { tools: [] });
  const progressSse = fakeClient((body) => {
    const stream = [
      ': keepalive',
      '',
      'event: message',
      'data: ' +
        JSON.stringify({
          jsonrpc: '2.0',
          method: 'notifications/progress',
          params: { progress: 1 },
        }),
      '',
      'data: ' + JSON.stringify({ jsonrpc: '2.0', id: body.id + 100, result: { ignored: true } }),
      '',
      'event: message',
      'data: {"jsonrpc":"2.0",',
      `data: "id":${body.id},"result":{"tools":[{"name":"中文读取"}]}}`,
      '',
      '',
    ].join('\r\n');
    const encoded = encoder.encode(stream);
    const chunks = [];
    // Split in the middle of CRLF boundaries and Chinese UTF-8 characters.
    for (let offset = 0; offset < encoded.length; offset += 3)
      chunks.push(encoded.slice(offset, offset + 3));
    return streamResponse(chunks);
  });
  assert.deepEqual(await progressSse.client.listTools(), { tools: [{ name: '中文读取' }] });

  for (const [status, message] of [
    [401, /授权无效/],
    [403, /授权无效/],
    [429, /额度或频率/],
    [503, /HTTP 503/],
  ]) {
    let cancelled = false;
    const rejected = fakeClient(() =>
      streamResponse([token + privateData], {
        status,
        cancel() {
          cancelled = true;
        },
      }),
    );
    await safeFailure(() => rejected.client.listTools(), message);
    assert.equal(cancelled, true, 'HTTP 错误时应释放响应流');
  }
  const rpcError = fakeClient(
    (body) =>
      new Response(
        JSON.stringify({
          jsonrpc: '2.0',
          id: body.id,
          error: { code: -32000, message: token, data: privateData },
        }),
      ),
  );
  await safeFailure(() => rpcError.client.listTools(), /接口调用失败/);
  const toolError = fakeClient((body) =>
    jsonResponse(body.id, {
      isError: true,
      content: [{ type: 'text', text: token + privateData }],
    }),
  );
  await safeFailure(() => toolError.client.call('test.read', {}), /读取失败/);
  const connectionError = fakeClient(() => {
    throw new Error(token + privateData);
  });
  await safeFailure(() => connectionError.client.listTools(), /无法连接/);
  const malformed = fakeClient(() => new Response('{"secret":"' + token + privateData));
  await safeFailure(() => malformed.client.listTools(), /格式无效/);
  const malformedTool = fakeClient((body) =>
    jsonResponse(body.id, {
      content: [{ type: 'text', text: token + privateData }],
    }),
  );
  await safeFailure(() => malformedTool.client.call('test.read', {}), /格式无法识别/);
  const wrongId = fakeClient((body) => jsonResponse(body.id + 1, { secret: token + privateData }));
  await safeFailure(() => wrongId.client.listTools(), /完整结果/);
  const badResult = fakeClient((body) => jsonResponse(body.id, null));
  await safeFailure(() => badResult.client.listTools(), /数据格式不完整/);
  const interrupted = fakeClient(
    () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.error(new Error(token + privateData));
          },
        }),
      ),
  );
  await safeFailure(() => interrupted.client.listTools(), /响应中断/);
  let cancelledLargeBody = false;
  const oversized = fakeClient(() =>
    streamResponse([new Uint8Array(8 * 1024 * 1024 + 1)], {
      contentType: 'application/json',
      keepOpen: true,
      cancel() {
        cancelledLargeBody = true;
      },
    }),
  );
  await safeFailure(() => oversized.client.listTools(), /内容过大/);
  assert.equal(cancelledLargeBody, true, '超限响应应立即停止读取');

  for (const stage of ['request', 'body']) {
    const controller = new AbortController();
    let observedAbort = false;
    const timed = fakeClient(() => {
      if (stage === 'request')
        return new Promise((_resolve, reject) => {
          controller.signal.addEventListener(
            'abort',
            () => {
              observedAbort = true;
              reject(controller.signal.reason);
            },
            { once: true },
          );
        });
      return new Response(
        new ReadableStream({
          start(streamController) {
            controller.signal.addEventListener(
              'abort',
              () => {
                observedAbort = true;
                streamController.error(controller.signal.reason);
              },
              { once: true },
            );
          },
        }),
      );
    }, controller.signal);
    const timeout = setTimeout(
      () => controller.abort(new DOMException(token + privateData, 'TimeoutError')),
      5,
    );
    try {
      await safeFailure(() => timed.client.listTools(), stage === 'request' ? /超时/ : /响应中断/);
      assert.equal(observedAbort, true, '请求及响应体阶段都应遵守外部超时信号');
    } finally {
      clearTimeout(timeout);
    }
  }

  // A rejected stream cancellation must not bypass the sanitized HTTP error.
  const cancellationError = fakeClient(() =>
    streamResponse([], {
      status: 401,
      keepOpen: true,
      cancel() {
        throw new Error(token + privateData);
      },
    }),
  );
  await safeFailure(() => cancellationError.client.listTools(), /授权无效/);
  const notificationCancellation = fakeClient((body) =>
    body.method === 'initialize'
      ? jsonResponse(body.id, { capabilities: {} })
      : streamResponse([], {
          status: 202,
          keepOpen: true,
          cancel() {
            throw new Error(token + privateData);
          },
        }),
  );
  await notificationCancellation.client.initialize();

  const values = {
    姓名: '林同学',
    班级: '软件2401',
    学号: ' p012345678 ',
    电话: '0013800000001',
    邮箱: 'student@example.com',
    自我介绍: '第一行\n第二行',
  };
  const originalValues = structuredClone(values);
  const registration = registrationFromValues('record-stable-1', values);
  assert.deepEqual(registration, {
    remoteId: 'record-stable-1',
    name: '林同学',
    className: '软件2401',
    studentId: 'P012345678',
    phone: '0013800000001',
    email: 'student@example.com',
    extra: { 自我介绍: '第一行\n第二行' },
  });
  assert.deepEqual(values, originalValues, '字段归一化不得修改原始答卷');
  const normalizedLabels = Object.fromEntries(
    Object.entries(values).map(([label, value]) => [
      ' ' + label.split('').join(' ') + (label === '电话' ? ' (必填) ' : ' （必填）\n'),
      value,
    ]),
  );
  assert.deepEqual(registrationFromValues('record-stable-1', normalizedLabels), registration);
  const richText = registrationFromValues('rich-text', {
    ...values,
    姓名: [{ text: '林' }, { text: '同学' }],
    电话: [{ text: '00138' }, { text: '00000001' }],
    自我介绍: [{ text: '保留\n' }, { text: '换行和符号：AI' }],
  });
  assert.equal(richText.name, '林同学');
  assert.equal(richText.phone, '0013800000001');
  assert.equal(richText.extra.自我介绍, '保留\n换行和符号：AI');
  assert.equal(
    registrationFromValues('numeric-phone', { ...values, 电话: 13800000001 }).phone,
    '13800000001',
  );
  assert.equal(registrationFromValues('empty-phone', { ...values, 电话: null }).phone, '');
  assert.throws(
    () => registrationFromValues('duplicate-fields', { ...values, ' 姓 名（必填）': privateData }),
    /重名字段/,
  );
  const missingName = { ...values };
  delete missingName.姓名;
  assert.throws(() => registrationFromValues('missing-name', missingName), /缺少“姓名”字段/);
  for (const invalid of [true, { value: privateData }, [privateData], [{ text: 123 }], [null]]) {
    assert.throws(
      () => registrationFromValues('illegal-value', { ...values, 姓名: invalid }),
      (error) => {
        assert.ok(error instanceof TencentDocsError);
        assert.equal(error.message.includes(privateData), false);
        return true;
      },
    );
  }
  const sourceConfig = { fileId: 'test-file', sheetId: 'test-sheet' };
  const titles = [
    '姓名（必填）',
    '班级（必填）',
    '学号（必填）',
    '电话（必填）',
    '邮箱',
    '自我介绍（必填）',
  ];
  const metadata = {
    fields: [...titles.map((field_title) => ({ field_title })), { field_title: '创建人' }],
    has_more: false,
    error: '',
  };
  const remoteRecord = (recordId, overrides = {}) => {
    const cells = { ...values, ...overrides };
    return {
      record_id: recordId,
      field_values: [
        ...titles.map((field) => {
          const key = field.replace('（必填）', '');
          return key === '电话' || key === '学号'
            ? { field, string_value: cells[key] }
            : { field, text_value: { items: [{ text: cells[key], type: 'text' }] } };
        }),
        { field: '创建人', unsupported_profile_value: privateData },
      ],
    };
  };
  const remote1 = remoteRecord('record-1');
  const remote2 = remoteRecord('record-2', {
    姓名: '陈同学',
    学号: 'P012345679',
    电话: '0013800000002',
  });
  const page = (records, overrides = {}) => ({
    records,
    has_more: false,
    next: 0,
    total: records.length,
    error: '',
    ...overrides,
  });
  const paginated = (pages, schema = metadata) => {
    const calls = [];
    let index = 0;
    return {
      calls,
      async call(name, args) {
        calls.push({ name, args });
        assert.equal(args.file_id, sourceConfig.fileId);
        assert.equal(args.sheet_id, sourceConfig.sheetId);
        assert.equal(args.limit, 100);
        if (name === 'smartsheet.list_fields') {
          assert.equal(calls.length, 1, '应先读取元数据再查询答卷');
          assert.equal(args.offset, 0);
          return structuredClone(schema);
        }
        assert.equal(name, 'smartsheet.list_records');
        assert.deepEqual(args.field_titles, titles, '仅请求报名字段，不读取创建人等用户资料');
        const result = pages[index++];
        if (result instanceof Error) throw result;
        assert.ok(result, '不应额外读取未声明的分页');
        return structuredClone(result);
      },
    };
  };
  const completePages = paginated([
    page([remote1], { has_more: true, next: 100, total: 2 }),
    page([remote2], { total: 2 }),
  ]);
  const complete = await fetchTencentRecords(completePages, sourceConfig);
  assert.deepEqual(
    complete.map((record) => record.remoteId),
    ['record-1', 'record-2'],
  );
  assert.equal(complete[0].phone, '0013800000001', '分页读取仍须保留电话前导零');
  assert.equal(complete[0].studentId, 'P012345678');
  assert.equal(complete[1].name, '陈同学');
  assert.deepEqual(complete[0].extra, { 自我介绍: values.自我介绍 });
  assert.deepEqual(
    completePages.calls.map((call) => call.args.offset),
    [0, 0, 100],
  );
  const emptySource = paginated([page([])]);
  assert.deepEqual(
    await fetchTencentRecords(emptySource, sourceConfig),
    [],
    '经过完整元数据和总数验证才接受空表',
  );

  const rejectPages = async (pages, expected, schema = metadata) => {
    const source = paginated(pages, schema);
    let returned;
    await safeFailure(async () => {
      returned = await fetchTencentRecords(source, sourceConfig);
    }, expected);
    assert.equal(returned, undefined, '后续分页失败时不能返回已读取的部分答卷');
    return source;
  };
  await rejectPages(
    [page([remote1], { has_more: true, next: 100, total: 2 }), page([remote2], { total: 3 })],
    /报名正在变化/,
  );
  await rejectPages([page([remote1], { total: 2 })], /分页结果有遗漏/);
  await rejectPages([page([remote1, remote1], { total: 2 })], /重复记录/);
  await rejectPages(
    [
      page([remote1], { has_more: true, next: 100, total: 3 }),
      page([remote2], { has_more: true, next: 99, total: 3 }),
    ],
    /分页游标异常/,
  );
  await rejectPages([page([remote1], { has_more: true, next: 0, total: 2 })], /分页游标异常/);
  await rejectPages([page([remote1], { has_more: true, next: 1.5, total: 2 })], /分页游标异常/);
  await rejectPages([page([], { has_more: true, next: 100, total: 2 })], /分页游标异常/);
  await rejectPages([page([remote1], { total: undefined })], /分页数据不完整/);
  await rejectPages([page([remote1], { total: -1 })], /分页数据不完整/);
  await rejectPages([page([], { total: 3001 })], /超过 3000/);
  await rejectPages(
    [
      page([remote1], { has_more: true, next: 100, total: 2 }),
      new TencentDocsError('腾讯文档读取失败，请检查文档权限'),
    ],
    /读取失败/,
  );
  const badSchema = await rejectPages([], /六个字段/, {
    ...metadata,
    fields: metadata.fields.filter((field) => field.field_title !== titles[0]),
  });
  assert.equal(badSchema.calls.length, 1, '元数据缺字段时不能开始读取答卷');
  await rejectPages([], /六个字段/, {
    ...metadata,
    fields: [...metadata.fields, { field_title: ' 姓名 (必填) ' }],
  });
  await rejectPages([], /字段过多或结构不完整/, { ...metadata, has_more: true });
  await rejectPages([page([{ ...remote1, record_id: '' }])], /缺少稳定编号/);
  await rejectPages([page([{ ...remote1, field_values: undefined }])], /报名字段不完整/);
  await rejectPages(
    [
      page([
        {
          ...remote1,
          field_values: [...remote1.field_values, remote1.field_values[0]],
        },
      ]),
    ],
    /重名字段/,
  );
  await rejectPages(
    [
      page([
        {
          ...remote1,
          field_values: [{ field: titles[0], number_value: 123 }],
        },
      ]),
    ],
    /数据类型已变化/,
  );
  await rejectPages([page([], { error: token + privateData })], /接口|读取失败/);
  await rejectPages([], /接口|读取失败/, { ...metadata, error: token + privateData });
  console.log(
    '腾讯文档客户端验证通过：JSON/SSE、进度通知、会话、错误脱敏、限流与超时、大小限制、字段文本保真、元数据及完整分页验证与失败不返回部分答卷。',
  );
} finally {
  await rm(temporary, { recursive: true, force: true });
}
