import { afterEach } from 'vitest';
import { cleanup, configure } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

/**
 * How long `findBy*` and `waitFor` keep polling before giving up.
 *
 * Testing Library's default is 1s. That is the single biggest source of
 * flake in this suite: every one of these failures has surfaced as "Unable
 * to find an element", on a runner where the element does appear, just not
 * within a second of a contended jsdom render. Individual tests had started
 * passing `{ timeout: 5000 }` by hand to work around it, which fixes one
 * assertion at a time and leaves the next one to be discovered by a red
 * build.
 *
 * Waiting longer does not make a passing test slower - the poll resolves as
 * soon as the element is there. It only changes how long a genuinely absent
 * element takes to be reported, which is a price worth paying once per real
 * failure.
 */
configure({ asyncUtilTimeout: 10000 });

// jsdom doesn't implement <dialog> showModal/close, which the
// @readysetcloud/ui Modal relies on.
if (typeof HTMLDialogElement !== 'undefined' && !HTMLDialogElement.prototype.showModal) {
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
    this.open = false;
    this.dispatchEvent(new Event('close'));
  };
}

afterEach(() => {
  cleanup();
});
