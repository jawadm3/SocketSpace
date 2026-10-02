import 'server-only';

import { getWebEnv } from './env';
import { createLogger, type Logger } from './log';

let logger: Logger | undefined;

export function getLogger(): Logger {
  logger ??= createLogger(getWebEnv().LOG_LEVEL);
  return logger;
}
