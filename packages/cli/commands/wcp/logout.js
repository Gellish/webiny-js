const { setWcpPat } = require("./utils");

module.exports = () => ({
    type: "cli-command",
    name: "cli-command-wcp-logout",
    create({ yargs, context }) {
        yargs.command(
            "logout",
            `Log out from the Webiny Control Panel`,
            yargs => {
                yargs.example("$0 logout");
                yargs.option("debug", {
                    describe: `Turn on debug logs`,
                    type: "boolean"
                });
                yargs.option("debug-level", {
                    default: 1,
                    describe: `Set the debug logs verbosity level`,
                    type: "number"
                });
            },
            async () => {
                setWcpPat(null);
                context.info(`You've successfully logged out from Webiny Control Panel.`);
            }
        );
    }
});
