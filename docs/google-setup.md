# Connecting a Google account

For calendar and reminders, Culinola reads from a Google account. This needs an access of its
own at Google, which every installation creates for itself – once, free of charge, in about
ten minutes. Culinola only receives read access to calendars and contacts with it.

## 1. Create an access at Google

Sign in in the browser with the Google account whose calendars and contacts are to be shown.
The interface appears in German or English; the English names are used here.

1. **Create a project:** <https://console.cloud.google.com/projectcreate> – name `Culinola`, **Create**. Afterwards this project must be selected in the bar at the top.
2. **Turn on the APIs,** each with **Enable**:
   - Google Calendar API: <https://console.cloud.google.com/apis/library/calendar-json.googleapis.com>
   - People API: <https://console.cloud.google.com/apis/library/people.googleapis.com>
3. **Set up the consent screen:** <https://console.cloud.google.com/auth/overview> → **Get started**. App name `Culinola`, your own address as support address; Audience **External**; your own address as contact; confirm the policy, **Create**.
4. **Release access for your own account** – on the **Audience** page, one of two ways:
   - **Test mode:** enter your own Google account under **Test users**. This works immediately, but the sign-in expires every seven days and must then be repeated with `npm run google:login`.
   - **Permanent operation:** **Publish app**. Google only enables the button once a home page and a privacy policy on a domain of your own are entered on the **Branding** page and this domain is listed among the authorized domains. A review by Google is not necessary for your own use; you should not upload a logo, because that triggers a review.
5. **Create the credentials:** on the left **Clients** → **Create client** → Application type **Desktop app**, name `Culinola`, **Create**. In the window that follows, **Download JSON** – Google does not show the secret again later.
6. **Place the file:** put the downloaded file as `client.json` in the folder `data/google`.

`client.json`, like all credentials, belongs only in the data folder and never in the repository.

## 2. Sign in

```bash
npm run google:login
```

The command opens Google's sign-in page. There Google warns that the app has not been verified –
that is the case with an access you created yourself; via **Advanced** → **Continue to Culinola**
you can proceed. Allow both accesses (calendar, contacts). The sign-in is then stored in
`data/google/token.json`.

Google's response goes to an address that only your own computer can reach. The command
must therefore run on a computer with a browser. For a server without a screen: sign in on
another computer and copy the folder `data/google` to the server.

## 3. Enter the source

```json
{ "id": "google", "plugin": "source-google" }
```

Without further settings, Culinola shows the account's main calendar. Which calendars the account
sees is listed at `/api/v1/resources/google/calendars`; more can be added with
`"config": { "calendars": ["primary", "Name of the calendar"] }`. All settings
are described by the README in the section "Google account".

## Revoking access again

At <https://myaccount.google.com/permissions>, Culinola's access can be removed at any time.
Afterwards, delete `data/google/token.json`.
