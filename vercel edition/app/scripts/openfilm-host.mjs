import { startStudio } from "openfilm/studio";

process.env.OPENFILM_NO_UPDATE_CHECK = "1";

const studio = await startStudio({
  port: 0,
  openBrowser: () => {},
});

process.stdout.write(`${JSON.stringify({ origin: studio.origin, key: studio.key })}\n`);
process.stdin.resume();
process.stdin.on("end", () => {
  void studio.close().then(() => process.exit(0));
});
