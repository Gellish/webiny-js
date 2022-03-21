const userFunction = require("./_handler.js");
const https = require("https");

const TELEMETRY_ENDPOINT = "d16ix00y8ek390.cloudfront.net";
const MAXIMUM_MINUTES_UNTIL_REQUEST_FIRED = 5;
const MAXIMUM_LOGS_STORED_UNTIL_REQUEST_FIRED = 1000;

const localData = {
    apiKey: process.env.WCP_API_KEY,
    version: "1.0.0",
    logs: []
};

async function postTelemetryData(telemetryData) {
    return new Promise((resolve, reject) => {
        const options = {
            method: "POST",
            hostname: TELEMETRY_ENDPOINT,
            path: "/telemetry",
            headers: { "Content-Type": "application/json" },
            maxRedirects: 20
        };

        const req = https.request(options, function (res) {
            const chunks = [];

            res.on("data", function (chunk) {
                chunks.push(chunk);
            });

            res.on("end", function () {
                const body = Buffer.concat(chunks);
                const strigifiedBody = body.toString();
                resolve(JSON.parse(strigifiedBody));
            });

            res.on("error", function (error) {
                reject(error);
            });
        });

        const postData = JSON.stringify(telemetryData);

        req.write(postData);

        req.end();
    });
}

let timerRunning = false;

const initialTime = Date.now();

async function initTelemetryTimer() {
    if (timerRunning) {
        return;
    }

    timerRunning = true;

    setInterval(async () => {
        const timeInFiveMinutes = Date.now() + MAXIMUM_MINUTES_UNTIL_REQUEST_FIRED * 60000;
        if (timeInFiveMinutes > initialTime) {
            if (localData.logs.length > 0) {
                await postTelemetryData(localData);
                localData.logs = [];
            }
        }
    }, 1000);
}

async function addToTelemetryPackage(data) {
    localData.logs.push(data);

    if (localData.logs.length === MAXIMUM_LOGS_STORED_UNTIL_REQUEST_FIRED) {
        await postTelemetryData(localData);
        localData.logs = [];
    }
}

async function handler(args) {
    try {
        await initTelemetryTimer();
    } catch (error) {
        console.log("Error initializing telemetry:");
        console.log(error);
    }
    const executionStarted = Date.now();

    try {
        const result = await userFunction.handler(args);

        const executionDuration = Date.now() - executionStarted;

        await addToTelemetryPackage({
            error: false,
            executionDuration,
            functionName: process.env.AWS_LAMBDA_FUNCTION_NAME,
            createdOn: Date.now()
        });

        return result;
    } catch (error) {
        const executionDuration = Date.now() - executionStarted;

        await addToTelemetryPackage({
            error: true,
            executionDuration,
            functionName: process.env.AWS_LAMBDA_FUNCTION_NAME,
            createdOn: Date.now()
        });
    }
}

module.exports = {
    handler,
    localData,
    postTelemetryData
};
