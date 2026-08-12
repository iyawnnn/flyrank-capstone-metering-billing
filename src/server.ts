import "dotenv/config";
import { createApp } from "./app.js";

const port = Number(process.env.PORT ?? 3000);

const start = async (): Promise<void> => {
  const app = createApp();

  try {
    await app.listen({ port, host: "0.0.0.0" });
    console.log("Usage Metering & Billing Engine listening on port " + port);
  } catch (error) {
    app.log.error(error);
    process.exitCode = 1;
  }
};

void start();
