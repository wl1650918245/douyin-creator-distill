const { exportDouyinCookies } = require("../src/adapters/douyin/cookie-exporter");

const roleArg = process.argv.find((arg) => arg.startsWith("--role="));
const role = roleArg ? roleArg.slice("--role=".length) : "content";

exportDouyinCookies(role)
  .then((filepath) => console.log(filepath))
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
