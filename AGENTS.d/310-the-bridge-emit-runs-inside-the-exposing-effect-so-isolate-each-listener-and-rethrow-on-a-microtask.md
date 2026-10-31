## The bridge emit runs inside the exposing effect so isolate each listener and rethrow on a microtask

A throwing agent listener would otherwise break sibling listeners and the host's reactive flush; catch per listener and rethrow via queueMicrotask so it still surfaces.
