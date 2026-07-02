/**
 * Entry point: import every fixture (each registers tests via `test(...)`),
 * then run them. Add new fixture files to this list.
 */
import { run } from "./runner";

import "./tests/layout.test";
import "./tests/svg.test";
import "./tests/focus-reorder.test";
import "./tests/events.test";
import "./tests/inputs.test";
import "./tests/on-mount.test";
import "./tests/error-boundary.test";
import "./tests/resume.test";
import "./tests/scheduler.test";

run();
