// Origin of a sender URL if its protocol and host match one of the manifest's
// host patterns ("https://member.freemason.org/*"); any port is accepted.
export function allowedOrigin(url, patterns) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const ok = patterns.some((p) => {
    const m = /^([a-z]+):\/\/([^/]+)\//.exec(p);
    return m && u.protocol === `${m[1]}:` && u.hostname === m[2];
  });
  return ok ? u.origin : null;
}
