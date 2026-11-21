import { finalize, resume } from './services/finalize.service';

// The action's post step, at the end of the job, also after a cancel: it closes what the main step
// left open when that step died before it could, such as when the runner killed it.
resume();
finalize({ kind: 'cancelled', message: 'The run stopped before the review finished: the workflow was cancelled, timed out or crashed.' });
