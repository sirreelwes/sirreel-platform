/**
 * A refusal the operator can act on — never a stack trace on a phone.
 *
 * Thrown by any maintenance task (lib module) when it will not proceed and
 * knows why. The CLI turns it into exit code 2, /admin/maintenance into a
 * 409 with the `fix` line on the screen. Lives here, apart from any one
 * task, so a fleet task and a partner seed throw the same class and the
 * route needs one `instanceof`.
 */
export class TaskRefused extends Error {
  constructor(message: string, readonly fix: string) {
    super(message)
    this.name = 'TaskRefused'
  }
}
