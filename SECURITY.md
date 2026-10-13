# Security

## Reporting a vulnerability

Please do not open a public issue for a security problem. Report it privately through GitHub: on the repository page choose **Security → Report a vulnerability**. You will get an answer as soon as possible; this is a spare-time project, so please allow a few days.

Please include what you did, what happened, and the version or commit you used.

## What to know when running Culinola

- **The API is open until you set a setup password** (or create an access entry). Until then everyone on your network can read, switch and change the setup. Set the password under *Settings → Access protection*.
- **The setup password** is stored only as a salted check value (scrypt) in `data/secrets.json`. Wrong attempts are slowed down per origin. Signing in lasts 30 days in that browser; changing the password ends all sign-ins.
- **A forgotten password** is replaced with a setup code that Culinola writes into its data folder and its log. Whoever can read the files or the log of the installation can therefore take over the setup – protect them like the installation itself.
- **Pairing** hands a display its token directly; the person who confirms the code never sees it. Compare the code with the one on the device before allowing a request.
- **Access control decides who may do what; it does not encrypt.** Put HTTPS in front before reaching Culinola from outside your home network.
- **Credentials** for your sources are stored in `data/secrets.json` on the machine that runs Culinola. The API accepts them but never returns them.
- **Tokens** are stored in the browser of each display. Whoever knows a token has that access. One entry per device or program lets you remove a single one when a tablet is lost.
