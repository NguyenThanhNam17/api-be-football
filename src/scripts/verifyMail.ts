import dotenv from "dotenv";
import path from "path";
import {
  ensureMailProviderReady,
  getActiveMailProvider,
  getSmtpMissingConfigMessage,
  getSmtpSendFailureMessage,
} from "../helper/mail.helper";

dotenv.config({ path: path.resolve(__dirname, "../../.env") });
dotenv.config();

async function main() {
  const activeProvider = getActiveMailProvider();

  if (!activeProvider) {
    throw new Error(getSmtpMissingConfigMessage());
  }

  await ensureMailProviderReady({ force: true });
  console.log(`[MAIL] Provider ready: ${activeProvider}`);
}

main().catch((error) => {
  console.error("[MAIL] Provider verification failed");
  console.error(getSmtpSendFailureMessage(error));
  console.error(error);
  process.exit(1);
});
