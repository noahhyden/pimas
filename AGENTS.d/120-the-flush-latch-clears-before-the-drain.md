## The flush latch clears before the drain

Clear `scheduled` before flushEffects runs so a write inside an effect is serialized by the `flushing` guard and picked up by the same drain loop; clear it after and that write can be dropped.
