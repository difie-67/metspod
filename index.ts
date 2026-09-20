import "./db"; // ensures schema is created on boot
import { bot, setBotUsername } from "./bot";
import { startWatcher } from "./watcher";
import { formatAddress, getArbiterWallet, getServiceWalletInfo } from "./ton";
import { config } from "./config";
import { startMiniAppServer } from "./miniapp";

async function main() {
  await bot.api.setMyCommands([
    { command: "start", description: "Открыть главное меню" },
    { command: "newdeal", description: "Создать новую сделку" },
    { command: "mydeals", description: "Мои сделки" },
    { command: "wallet", description: "Указать TON-кошелёк" },
    { command: "status", description: "Статус сделки по номеру" },
    { command: "canceldeal", description: "Отменить неоплаченную сделку" },
    { command: "transparency", description: "Проверить on-chain прозрачность" },
    { command: "help", description: "Помощь и правила" },
    { command: "stop", description: "Закрыть текущий ввод" },
  ]).catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`Could not update Telegram command menu: ${message}`);
  });
  if (config.miniAppUrl) {
    await bot.api.setChatMenuButton({
      menu_button: {
        type: "web_app",
        text: "Открыть OBRA GUARANT",
        web_app: { url: config.miniAppUrl },
      },
    }).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`Could not update Telegram Mini App menu button: ${message}`);
    });
  }
  console.log(`TON network: ${config.tonNetwork}`);
  console.log(`TON endpoint: ${config.tonEndpoint}`);
  console.log(`Database: ${config.dbPath}`);
  console.log(`Admin Telegram IDs: ${config.arbiterTgIds.join(", ")}`);
  const arbiter = await getArbiterWallet();
  console.log(`Service wallet: ${formatAddress(arbiter.address)}`);
  try {
    const service = await getServiceWalletInfo();
    console.log(`Service wallet balance: ${Number(service.balance) / 1e9} TON (${service.state})`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`TON startup check failed: ${message}`);
  }
  startWatcher();
  startMiniAppServer();
  await bot.start({
    onStart: (info) => {
      setBotUsername(info.username);
      console.log(`Escrow bot started as @${info.username}`);
    },
  });
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
