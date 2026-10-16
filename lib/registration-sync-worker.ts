import { getRegistrationSyncStatus, triggerRegistrationSync } from './registration-sync-store';

let stopping = false;
let wake: (() => void) | undefined;
for (const signal of ['SIGTERM', 'SIGINT'] as const)
  process.once(signal, () => {
    stopping = true;
    wake?.();
  });

let lastMessage = '';
function report(message: string) {
  if (message === lastMessage) return;
  console.log(message);
  lastMessage = message;
}
while (!stopping) {
  try {
    let status = getRegistrationSyncStatus();
    if (
      status.enabled &&
      !status.running &&
      (!status.nextRunAt || Date.parse(status.nextRunAt) <= Date.now())
    )
      status = await triggerRegistrationSync();
    report(
      !status.enabled
        ? status.error
          ? '腾讯文档同步配置需要检查。'
          : '腾讯文档同步等待配置。'
        : status.error
          ? '腾讯文档同步未完成，稍后重试；请在工作台查看状态。'
          : '腾讯文档同步服务运行中。',
    );
  } catch {
    report('腾讯文档同步服务暂时不可用，稍后重试。');
  }
  if (stopping) break;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, 5000);
    wake = () => {
      clearTimeout(timer);
      resolve();
    };
  });
  wake = undefined;
}
