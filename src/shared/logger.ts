export class Logger {
  static log(module: string, message: string, data?: any) {
    const timestamp = new Date().toISOString();
    const logLine = `[${timestamp}] [${module}] ${message}`;
    console.log(logLine, data || '');
  }

  static error(module: string, message: string, error: any) {
    const timestamp = new Date().toISOString();
    console.error(`[${timestamp}] [${module}] ❌ ${message}`, error);
  }

  static warn(module: string, message: string, data?: any) {
    const timestamp = new Date().toISOString();
    console.warn(`[${timestamp}] [${module}] ⚠️ ${message}`, data || '');
  }
}
