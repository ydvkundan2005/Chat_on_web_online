# Real-time Web Chat

A browser-based real-time chat application built with HTML, CSS, JavaScript and Firebase Realtime Database.

The project explores user identifiers, chat conversations, real-time message updates and browser-based audio/video calling flows.

## Features represented in the current source

- Nickname-based user onboarding and generated user identifiers.
- User and conversation data stored through Firebase Realtime Database.
- Real-time message and call-state listeners.
- Audio/video calling flow using browser media APIs and WebRTC peer connections.
- Incoming-call, mute, speaker and hang-up interface controls.
- Responsive web interface and GitHub Pages deployment workflow.

Feature availability depends on browser permissions, network conditions, Firebase configuration and the behavior of the deployed database rules.

## Technology

| Area | Technology |
|---|---|
| Frontend | HTML, CSS, JavaScript |
| Database and synchronization | Firebase Realtime Database |
| Real-time media | WebRTC and browser media APIs |
| Connectivity discovery | STUN configuration in the WebRTC client |
| Deployment | GitHub Actions / GitHub Pages |

## Run and deploy

This is a static browser project. Review the Firebase configuration in `assets/js/app.js`, configure the corresponding Firebase project and database rules, then serve the repository or use its GitHub Pages deployment workflow.

For local preview:

```bash
python3 -m http.server 8000
```

Open `http://localhost:8000` in a browser that supports the required media APIs.

## Security and privacy considerations

This repository should be treated as a development prototype until its authentication, authorization and data handling are independently reviewed.

- Firebase Realtime Database rules are not included in this repository. Public client configuration does not replace server-enforced access rules.
- Review how user identifiers, passwords, chat messages and call signalling records are stored and accessed.
- A randomly generated user ID is not proof of identity or authorization.
- WebRTC media permissions must be granted by the user. Verify signalling authorization and peer identity before using the application with real users.
- Do not use the current prototype for confidential communication or sensitive personal data without a security review and tested access controls.

## Testing status

The repository does not currently include a dedicated automated test suite. Authentication and authorization, conversation isolation, database rules, call setup/teardown, denied media permissions, reconnects and multiple simultaneous calls need repeatable tests.

## Repository structure

```text
Chat_on_web_online/
├── .github/workflows/static.yml
├── assets/
│   ├── css/styles.css
│   └── js/
│       ├── app.js
│       └── legacy-globals.js
├── index.html
├── robots.txt
├── sitemap.xml
└── README.md
```

## Scope

This project demonstrates browser-based real-time application concepts. It is not represented as a production-secure messaging or calling service.
