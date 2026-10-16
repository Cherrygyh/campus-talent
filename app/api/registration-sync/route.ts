import { authorize, errorResponse, json } from '../../../lib/server';
import {
  getRegistrationSyncStatus,
  triggerRegistrationSync,
} from '../../../lib/registration-sync-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  try {
    await authorize(request);
    return json(getRegistrationSyncStatus());
  } catch (error) {
    return errorResponse(error);
  }
}
export async function POST(request: Request) {
  try {
    await authorize(request, true);
    return json(await triggerRegistrationSync());
  } catch (error) {
    return errorResponse(error);
  }
}
