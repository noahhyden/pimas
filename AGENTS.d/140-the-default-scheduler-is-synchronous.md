## The default scheduler is synchronous

A write returns with its effects already flushed, so a read straight after a write sees the new value; deferring is opt-in via `setScheduler`, and `flushSync` clears the latch so a dropped scheduler callback cannot wedge flushing for good.
