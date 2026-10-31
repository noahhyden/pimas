## The default scheduler is synchronous

Effects must have flushed when a write returns because renderToString and post-write DOM reads depend on it; deferring is opt-in via setScheduler, and flushSync clears the latch so a dropped scheduler callback cannot wedge flushing.
