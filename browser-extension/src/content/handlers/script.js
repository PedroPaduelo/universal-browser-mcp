/**
 * Handler de execução de scripts
 */

/**
 * Handler para executar JavaScript customizado na página
 */
export async function handleExecuteScript(data) {
  const { script, args = {} } = data;

  try {
    const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
    const fn = new AsyncFunction('args', script);

    const result = await fn(args);

    return {
      success: true,
      result: result !== undefined ? result : null,
      type: typeof result
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
      stack: error.stack?.split('\n').slice(0, 5).join('\n')
    };
  }
}
