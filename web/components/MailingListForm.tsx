// Public Listmonk list UUID; this is not an API key or an admin credential.
const LIST_UUID = "b7cfb7b6-9927-454b-811e-715f7e22f705";
const SIGNUP_URL = `https://lists.note15.com/subscription/form?list=${LIST_UUID}&brand=the-plate-lab`;

export function MailingListForm() {
  return (
    <form className="launch-signup" action={SIGNUP_URL} method="post">
      <label htmlFor="launch-email">Be first to see what’s next.</label>
      <input type="hidden" name="l" value={LIST_UUID} />
      <div className="launch-signup-trap" aria-hidden="true">
        <input name="nonce" tabIndex={-1} autoComplete="off" aria-label="Leave blank" />
      </div>
      <div className="launch-signup-row">
        <input
          id="launch-email"
          name="email"
          type="email"
          required
          autoComplete="email"
          placeholder="Your email address"
          aria-describedby="launch-signup-note"
        />
        <button type="submit">Keep me posted <span aria-hidden="true">↗</span></button>
      </div>
      <p id="launch-signup-note">
        Plate Lab news and launch updates. Confirm by email. Unsubscribe anytime.
      </p>
    </form>
  );
}
