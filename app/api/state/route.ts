import { authorize, errorResponse, HttpError, json, mutate, snapshot } from '../../../lib/server';
export async function GET(request: Request) {
  try {
    await authorize(request);
    return json(await snapshot());
  } catch (e) {
    return errorResponse(e);
  }
}
export async function POST(request: Request) {
  try {
    const user = await authorize(request, true);
    const text = await request.text();
    if (text.length > 1500000) throw new HttpError('导入数据过大，请分批导入', 413);
    return json(await mutate(JSON.parse(text), user.displayName));
  } catch (e) {
    return errorResponse(e);
  }
}
