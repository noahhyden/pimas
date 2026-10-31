## An async action records provenance only after its promise settles and records nothing on throw or reject

Record when the promise resolves so the awaited writes are captured; on a sync throw or a rejection call abort (stop the tap) and rethrow, never push a cause record.
