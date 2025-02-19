import { ImportExportTaskStatus, PbImportExportContext } from "~/types";
import { invokeHandlerClient } from "~/client";
import { NotFoundError } from "@webiny/handler-graphql";
import { exportBlock } from "~/export/utils";
import { Payload as ExtractPayload } from "../combine";
import { mockSecurity } from "~/mockSecurity";
import { SecurityIdentity } from "@webiny/api-security/types";
import { zeroPad } from "@webiny/utils";
import { Configuration, Payload, Response } from "~/export/process";

/**
 * Handles the export blocks process workflow.
 */
export const blocksHandler = async (
    configuration: Configuration,
    payload: Payload,
    context: PbImportExportContext
): Promise<Response> => {
    const log = console.log;
    let subTask;
    let noPendingTask = true;
    let prevStatusOfSubTask = ImportExportTaskStatus.PENDING;

    log("RUNNING Export Blocks Process Handler");
    const { pageBuilder, fileManager } = context;
    const { taskId, subTaskIndex, type, identity } = payload;
    // Disable authorization; this is necessary because we call Page Builder CRUD methods which include authorization checks
    // and this Lambda is invoked internally, without credentials.
    mockSecurity(identity as SecurityIdentity, context);
    try {
        /*
         * Note: We're not going to DB for finding the next sub-task to process,
         * because the data might be out of sync due to GSI eventual consistency.
         */
        subTask = await pageBuilder.importExportTask.getSubTask(taskId, zeroPad(subTaskIndex, 5));
        /**
         * Base condition!!
         * Bail out early, if task not found or task's status is not "pending".
         */
        if (!subTask || subTask.status !== ImportExportTaskStatus.PENDING) {
            noPendingTask = true;
            return {
                data: "",
                error: null
            };
        } else {
            noPendingTask = false;
        }

        log(`Fetched sub task => ${subTask.id}`);

        const { input } = subTask;
        const { blockId, exportBlocksDataKey } = input;

        const block = await pageBuilder.getPageBlock(blockId);

        if (!block) {
            log(`Unable to load block "${blockId}"`);
            throw new NotFoundError(`Unable to load block "${blockId}"`);
        }

        log(`Processing block key "${blockId}"`);

        // Mark task status as PROCESSING
        subTask = await pageBuilder.importExportTask.updateSubTask(taskId, subTask.id, {
            status: ImportExportTaskStatus.PROCESSING
        });
        // Update stats in main task
        await pageBuilder.importExportTask.updateStats(taskId, {
            prevStatus: prevStatusOfSubTask,
            nextStatus: ImportExportTaskStatus.PROCESSING
        });
        prevStatusOfSubTask = subTask.status;

        log(`Extracting block data and uploading to storage...`);
        // Extract Block
        const blockDataZip = await exportBlock(block, exportBlocksDataKey, fileManager);
        log(`Finish uploading zip...`);
        // Update task record in DB
        subTask = await pageBuilder.importExportTask.updateSubTask(taskId, subTask.id, {
            status: ImportExportTaskStatus.COMPLETED,
            data: {
                message: `Finish uploading data for block "${block.id}"`,
                key: blockDataZip.Key
            }
        });
        // Update stats in main task
        await pageBuilder.importExportTask.updateStats(taskId, {
            prevStatus: prevStatusOfSubTask,
            nextStatus: ImportExportTaskStatus.COMPLETED
        });
        prevStatusOfSubTask = subTask.status;
    } catch (e) {
        log("[EXPORT_BLOCKS_PROCESS] Error => ", e.message);

        if (subTask && subTask.id) {
            /**
             * In case of error, we'll update the task status to "failed",
             * so that, client can show notify the user appropriately.
             */
            subTask = await pageBuilder.importExportTask.updateSubTask(taskId, subTask.id, {
                status: ImportExportTaskStatus.FAILED,
                error: {
                    name: e.name,
                    message: e.message,
                    code: "EXPORT_FAILED"
                }
            });

            // Update stats in main task
            await pageBuilder.importExportTask.updateStats(taskId, {
                prevStatus: prevStatusOfSubTask,
                nextStatus: ImportExportTaskStatus.FAILED
            });
            prevStatusOfSubTask = subTask.status;
        }

        return {
            data: null,
            error: {
                message: e.message
            }
        };
    } finally {
        // Base condition!
        if (noPendingTask) {
            log(`No pending sub-task for task ${taskId}`);
            // Combine individual block zip files.
            await invokeHandlerClient<ExtractPayload>({
                context,
                name: configuration.handlers.combine,
                payload: {
                    taskId,
                    type,
                    identity: context.security.getIdentity()
                },
                description: "Export blocks - combine"
            });
        } else {
            console.log(`Invoking PROCESS for task "${subTaskIndex + 1}"`);
            // We want to continue with Self invocation no matter if current block error out.
            await invokeHandlerClient<Payload>({
                context,
                name: configuration.handlers.process,
                payload: {
                    taskId,
                    subTaskIndex: subTaskIndex + 1,
                    type,
                    identity: context.security.getIdentity()
                },
                description: "Export blocks - process - subtask"
            });
        }
    }
    return {
        data: "",
        error: null
    };
};
