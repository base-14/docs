<div align="center">

# base14 Scout Documentation

<img src="./static/img/logo.svg" alt="base14 Scout Logo" width="200"/>

**Reduce downtime drastically with intelligent telemetry collection and analysis**

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Docusaurus](https://img.shields.io/badge/built%20with-Docusaurus-green.svg)](https://docusaurus.io/)
[![Website](https://img.shields.io/badge/website-docs.base14.io-blue)](https://docs.base14.io)

</div>

## 🚀 About base14 Scout

base14 Scout is a powerful telemetry collection and analysis platform designed to help you monitor your applications and infrastructure with ease. Scout collects logs, metrics, and traces from your systems using OpenTelemetry, providing valuable insights to reduce downtime and improve system reliability.

### Key Features

- **Comprehensive Telemetry Collection**: Collect logs, metrics, and traces from various environments
- **Multi-Environment Support**: Works with Docker, Kubernetes, and traditional Linux deployments
- **OpenTelemetry Integration**: Leverages the power of OpenTelemetry for standardized telemetry collection
- **Easy Setup**: Simple configuration for various deployment scenarios
- **Powerful Analysis**: Gain insights into your system's performance and health

## 📚 Documentation

This repository contains the documentation website for base14 Scout, built with [Docusaurus](https://docusaurus.io/). The documentation covers:

- Getting started guides
- Installation instructions for different environments
- Configuration examples
- Best practices
- Troubleshooting tips

Visit [docs.base14.io](https://docs.base14.io) to view the live documentation.

## 🛠️ Local Development

### Prerequisites

- [Node.js](https://nodejs.org/en/download/) (version 18 or above)

### Installation

```bash
$ npm ci
```

### Local Development Server

```bash
$ npm start
```

This command starts a local development server and opens up a browser window. Most changes are reflected live without having to restart the server.

### Build

```bash
$ npm run build
```

This command generates static content into the `build` directory and can be served using any static contents hosting service.

### Deployment

Using SSH:

```bash
$ USE_SSH=true npm run deploy
```

Not using SSH:

```bash
$ GIT_USER=<Your GitHub username> npm run deploy
```

## 🤝 Contributing

Contributions are welcome! If you'd like to improve the documentation:

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-improvement`)
3. Commit your changes (`git commit -m 'Add some amazing improvement'`)
4. Push to the branch (`git push origin feature/amazing-improvement`)
5. Open a Pull Request

## 📞 Support

If you encounter any issues or have questions about base14 Scout, please visit:

- [GitHub Issues](https://github.com/base-14/docs/issues)
- [base14 Website](https://base14.io)

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

<div align="center">

[Website](https://base14.io) • [Twitter](https://twitter.com/base14io) • [LinkedIn](https://www.linkedin.com/company/base14-io) • [GitHub](https://github.com/base-14)

</div>
