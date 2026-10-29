# Copilot Local Repo Bridge: data handling

This optional bridge runs on the repository owner's computer. It exposes only the repositories configured by that owner, through an authenticated HTTP API. Microsoft 365 Copilot receives the requested file contents, directory listings, and Git output when the owner uses the agent. Generated agent packages contain public endpoint metadata and an API key registration ID; they do not contain the bridge secret or local configuration file.

The HTTPS tunnel provider carries requests and responses between Microsoft 365 and the local service. The local server and tunnel must remain running for access. This project does not operate a hosted relay or collect project telemetry. Microsoft 365, its organizational retention settings, and the selected tunnel provider apply their own terms and data handling policies. This project cannot override those policies.

The owner is responsible for selecting repositories and data appropriate for their Microsoft 365 tenant. Do not share the agent, API key registration, or tunnel with other users unless they should receive access to every repository configured for this service. An API key identifies the bridge installation, not an individual Microsoft 365 user.

The owner can revoke access by stopping the bridge/tunnel, removing repositories from local configuration, or rotating the local token and updating its Microsoft API key registration. Existing data already returned to a conversation remains subject to Microsoft 365's retention rules.

This is a community integration, not a Microsoft product. It is provided under the repository's MIT license. See [the setup guide](COPILOT.zh-CN.md) for the supported scope and validation status.
