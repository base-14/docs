# Website

This website is built using [Docusaurus](https://docusaurus.io/), a modern
static website generator.

## Setup

> Install the Required Packages

```shell
yarn
```

> Install Pre-commit Hook
> To set up Git pre-commit hooks,
> you first need to install the pre-commit tool.
> Follow the instructions in
> the [official documentation](https://pre-commit.com/).

```shell
pre-commit install
```

## Local Development

```shell
yarn start
```

This command starts a local development server and opens up a browser window.
Most changes are reflected live without having to restart the server.

## Build

```shell
yarn build
```

This command generates static content into the `build` directory and can be
served using any static contents hosting service.

## Deployment

Using SSH:

```shell
USE_SSH=true yarn deploy
```

Not using SSH:

```shell
GIT_USER=<Your GitHub username> yarn deploy
```

If you are using GitHub pages for hosting, this command is a convenient way to
build the website and push to the `gh-pages` branch.
