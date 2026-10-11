export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { validateConfiguration } = await import("./lib/config");
    validateConfiguration();
  }
}
