export {
    appendTagToCommentBody,
    applyBatchTagToThreads,
    persistBatchTagMutation,
    removeTagFromCommentBody,
    removeBatchTagFromThreads,
    threadHasTag,
} from "../../comments/commentBatchTagOperations";
export type {
    BatchTagMutationResult,
    BatchTagOperationFailure,
    BatchTagOperationResult,
} from "../../comments/commentBatchTagOperations";
