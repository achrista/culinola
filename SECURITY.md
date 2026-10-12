# Security

## Reporting a vulnerability

Please do not open a public issue for a security problem. Report it privately through GitHub: on the repository page choose **Security → Report a vulnerability**. You will get an answer as soon as possible; this is a spare-time project, so please allow a few days.

Please include what you did, what happened, and the version or commit you used.

## What to know when running Culinola

- **The API is open until you create an access token.** Without access entries everyone on your network can read, switch and change the setup. Create one under *Settings → Access*.
- **Access control decides who may do what; it does not encrypt.** Put HTTPS in front before reaching Culinola from outside your home network.
- **Credentials** for your sources are stored in `data/secrets.json` on the machine that runs Culinola. The API accepts them but never returns them.
- **Tokens** are stored in the browser of each display. Whoever knows a token has that access.
