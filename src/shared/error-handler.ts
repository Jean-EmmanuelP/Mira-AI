export class ErrorHandler {
  static handle(error: any, context: string) {
    const timestamp = new Date().toISOString();
    const errorLog = {
      timestamp,
      context,
      message: error.message,
      stack: error.stack?.split('\n').slice(0, 3),
    };

    console.error(JSON.stringify(errorLog));

    return {
      error: 'Something went wrong',
      context,
      timestamp,
    };
  }
}
