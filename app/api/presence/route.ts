import { db, errorResponse, HttpError, json } from '../../../lib/server';
import { joinEditor, leaveEditor, readPresence } from '../../../lib/presence';
import { hasTrustedOrigin } from '../../../lib/request-origin';
export async function GET() {
  try {
    return json(await readPresence(db()));
  } catch (e) {
    return errorResponse(e);
  }
}
export async function POST(request: Request) {
  try {
    if (!hasTrustedOrigin(request)) throw new HttpError('来源校验失败', 403);
    const text = await request.text();
    if (text.length > 1500) throw new HttpError('会话信息过长', 413);
    const body = JSON.parse(text);
    if (body.op === 'leave') return json(await leaveEditor(db(), body));
    if (body.op !== 'join') throw new HttpError('不支持的协作操作');
    const result = await joinEditor(db(), body);
    return json(result, result.admitted ? 200 : 429);
  } catch (e) {
    return errorResponse(e);
  }
}
