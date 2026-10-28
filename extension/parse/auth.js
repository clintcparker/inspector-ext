// The site (Devise) redirects signed-out requests to /users/sign_in.
export function isSignInResponse(url, html) {
  return new URL(url).pathname.startsWith("/users/sign_in") || /name="user\[password\]"/.test(html);
}
