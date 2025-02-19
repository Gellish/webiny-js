/**
 * Package mdbid does not have types.
 */
// @ts-ignore
import mdbid from "mdbid";
import WebinyError from "@webiny/error";
import { NotFoundError } from "@webiny/handler-graphql";
import { createTopic } from "@webiny/pubsub";
import joi from "joi";

import {
    FoldersConfig,
    ILinks,
    Link,
    LinkInput,
    ListLinksParams,
    ListLinksResponse,
    OnLinkAfterCreateTopicParams,
    OnLinkAfterDeleteBatchTopicParams,
    OnLinkAfterDeleteTopicParams,
    OnLinkAfterUpdateTopicParams,
    OnLinkBeforeCreateTopicParams,
    OnLinkBeforeDeleteBatchTopicParams,
    OnLinkBeforeDeleteTopicParams,
    OnLinkBeforeUpdateTopicParams
} from "~/types";

const requiredString = joi.string().required();

const createSchema = joi.object({
    id: requiredString,
    folderId: requiredString,
    tenant: requiredString,
    locale: requiredString
});

const updateSchema = joi.object({
    folderId: requiredString
});

export const createLinksContext = async ({
    getTenantId,
    getLocaleCode,
    getIdentity,
    storageOperations
}: FoldersConfig): Promise<ILinks> => {
    // create
    const onLinkBeforeCreate = createTopic<OnLinkBeforeCreateTopicParams>(
        "folders.onLinkBeforeCreate"
    );
    const onLinkAfterCreate = createTopic<OnLinkAfterCreateTopicParams>(
        "folders.onLinkAfterCreate"
    );
    // update
    const onLinkBeforeUpdate = createTopic<OnLinkBeforeUpdateTopicParams>(
        "folders.onLinkBeforeUpdate"
    );
    const onLinkAfterUpdate = createTopic<OnLinkAfterUpdateTopicParams>(
        "folders.onLinkAfterUpdate"
    );
    // delete
    const onLinkBeforeDelete = createTopic<OnLinkBeforeDeleteTopicParams>(
        "folders.onLinkBeforeDelete"
    );
    const onLinkAfterDelete = createTopic<OnLinkAfterDeleteTopicParams>(
        "folders.onLinkAfterDelete"
    );
    // delete batch
    const onLinkBeforeDeleteBatch = createTopic<OnLinkBeforeDeleteBatchTopicParams>(
        "folders.onLinkBeforeDeleteBatch"
    );
    const onLinkAfterDeleteBatch = createTopic<OnLinkAfterDeleteBatchTopicParams>(
        "folders.onLinkAfterDeleteBatch"
    );

    return {
        onLinkBeforeCreate,
        onLinkAfterCreate,
        onLinkBeforeUpdate,
        onLinkAfterUpdate,
        onLinkBeforeDelete,
        onLinkAfterDelete,
        onLinkBeforeDeleteBatch,
        onLinkAfterDeleteBatch,
        async getLink(id: string): Promise<Link> {
            const tenant = getTenantId();
            const locale = getLocaleCode();

            let link: Link | undefined;
            try {
                link = await storageOperations.getLink({ tenant, locale, id });
            } catch (error) {
                throw WebinyError.from(error, {
                    message: "Could not get link.",
                    code: "GET_LINK_ERROR",
                    data: { id }
                });
            }
            if (!link) {
                throw new NotFoundError(`Unable to find link with id: ${id}`);
            }
            return link;
        },

        async listLinks({ where, limit, after }: ListLinksParams): Promise<ListLinksResponse> {
            const tenant = getTenantId();
            const locale = getLocaleCode();

            try {
                return await storageOperations.listLinks({
                    where: { tenant, locale, ...where },
                    sort: ["createdOn_ASC"],
                    limit,
                    after
                });
            } catch (error) {
                throw WebinyError.from(error, {
                    message: "Could not list links.",
                    code: "LIST_LINKS_ERROR",
                    data: { ...where, limit, after }
                });
            }
        },

        async createLink(input: LinkInput): Promise<Link> {
            await createSchema.validate(input);

            const tenant = getTenantId();
            const locale = getLocaleCode();

            const existing = await storageOperations.getLink({
                tenant,
                locale,
                folderId: input.folderId,
                id: input.id
            });

            if (existing) {
                throw new WebinyError(`Link with id "${input.id}" already exists.`, "LINK_EXISTS");
            }

            const identity = getIdentity();

            const link: Link = {
                linkId: mdbid(),
                tenant,
                locale,
                ...input,
                webinyVersion: process.env.WEBINY_VERSION as string,
                createdOn: new Date().toISOString(),
                createdBy: {
                    id: identity.id,
                    displayName: identity.displayName,
                    type: identity.type
                }
            };

            try {
                await onLinkBeforeCreate.publish({
                    link
                });
                const result = await storageOperations.createLink({ link });
                await onLinkAfterCreate.publish({
                    link: result
                });
                return result;
            } catch (error) {
                throw WebinyError.from(error, {
                    message: "Could not create link.",
                    code: "CREATE_LINK_ERROR",
                    data: { ...input }
                });
            }
        },

        async updateLink(id: string, input: Record<string, any>): Promise<Link> {
            const tenant = getTenantId();
            const locale = getLocaleCode();

            const original = await storageOperations.getLink({ tenant, locale, id });

            if (!original) {
                throw new NotFoundError(`Link "${id}" was not found!`);
            }

            await updateSchema.validate(input);

            const link: Link = {
                ...original,
                ...input
            };

            try {
                await onLinkBeforeUpdate.publish({
                    link,
                    original
                });
                const result = await storageOperations.updateLink({ original, link });
                await onLinkAfterUpdate.publish({
                    link: result,
                    original
                });
                return result;
            } catch (error) {
                throw new WebinyError(
                    error.message || "Could not update link.",
                    error.code || "UPDATE_LINK_ERROR",
                    {
                        link
                    }
                );
            }
        },

        async deleteLink(id: string): Promise<void> {
            const tenant = getTenantId();
            const locale = getLocaleCode();

            const link = await storageOperations.getLink({ tenant, locale, id });

            if (!link) {
                throw new NotFoundError(`Link "${id}" was not found!`);
            }

            try {
                await onLinkBeforeDelete.publish({
                    link
                });
                const result = await storageOperations.deleteLink({ link });
                await onLinkAfterDelete.publish({
                    link
                });
                return result;
            } catch (error) {
                throw new WebinyError(
                    error.message || "Could not delete link.",
                    error.code || "DELETE_LINK_ERROR",
                    {
                        link
                    }
                );
            }
        },

        async deleteLinks(folderIds: string[]): Promise<void> {
            const tenant = getTenantId();
            const locale = getLocaleCode();

            try {
                await onLinkBeforeDeleteBatch.publish({
                    folderIds
                });
                const result = await storageOperations.deleteLinks({ tenant, locale, folderIds });
                await onLinkAfterDeleteBatch.publish({
                    folderIds
                });
                return result;
            } catch (error) {
                throw new WebinyError(
                    error.message || "Could not batch delete links.",
                    error.code || "DELETE_LINKS_ERROR",
                    {
                        folderIds
                    }
                );
            }
        }
    };
};
