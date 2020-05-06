# Flight Console API

A web API to provide browser access to an interactive terminal console.

## Overview

Flight Console API is a web API that in conjunction with [Flight Console
Webapp](https://github.com/openflighthpc/flight-console-webapp) provides
browser access to an interactive terminal console session within HPC
environments.

## Installation

### From source

Flight Console API requires a recent version of Node and `yarn`.

The following will install from source using `git`:

```
git clone https://github.com/openflighthpc/flight-console-api.git
cd flight-console-api
yarn install
yarn run build
```

### Installing with Flight Runway

Flight Runway provides a Ruby environment and command-line helpers for
running openflightHPC tools.  Flight Console API integrates with Flight
Runway to provide easier installation and configuration.

To install Flight Runway, see the [Flight Runway installation
docs](https://github.com/openflighthpc/flight-runway#installation).

These instructions assume that `flight-runway` has been installed from
the openflightHPC yum repository and that either [system-wide
integration](https://github.com/openflighthpc/flight-runway#system-wide-integration)
has been enabled or the
[`flight-starter`](https://github.com/openflighthpc/flight-starter) tool has
been installed and the environment activated with the `flight start` command.

 * Enable the Alces Flight RPM repository:

    ```
    yum install -e0 https://repo.openflighthpc.org/openflight/centos/7/x86_64/openflighthpc-release-2-1.noarch.rpm
    ```

 * Rebuild your `yum` cache:

    ```
    yum makecache
    ```
    
 * Install the `flight-console-api` RPM:

    ```
    [root@myhost ~]# yum install flight-console-api
    ```

 * Enable HTTPs support

    Flight Console API is designed to operate over HTTPs connections.  You
    can enable HTTPs with self-signed certificates by running the commands
    below.  You will be asked to enter a passphrase and to answer some
    questions about your organization.

    ```
    [root@myhost ~]# flight www enable-https
    ```

## Configuration

### When installed with Flight Runway

By default, Flight Console API does not need any configuration.  If you wish
to configure it, you may do so by editing the configuration file located at
`/opt/flight/opt/console-api/etc/config.json`


### When installed from source

By default, Flight Console API does not need any configuration.  If you wish
to configure it, you may do so by editing or creating the configuration file
located at `etc/config.json` relative to the Flight Console API source code
directory.

## Operation

### When installed with Flight Runway

The server can be started by running the following command:

```
[root@myhost ~]# flight service start console-api
```

The server can be stopped by running the following command:

```
[root@myhost ~]# flight service stop console-api
```

### When installed from source

The server can be started by running the following from the root directory of
the source checkout.

```
yarn run start 
```

The server can be stopped by killing that process.


# Contributing

Fork the project. Make your feature addition or bug fix. Send a pull
request. Bonus points for topic branches.

Read [CONTRIBUTING.md](CONTRIBUTING.md) for more details.

# Copyright and License

Eclipse Public License 2.0, see [LICENSE.txt](LICENSE.txt) for details.

Copyright (C) 2019-present Alces Flight Ltd.

This program and the accompanying materials are made available under
the terms of the Eclipse Public License 2.0 which is available at
[https://www.eclipse.org/legal/epl-2.0](https://www.eclipse.org/legal/epl-2.0),
or alternative license terms made available by Alces Flight Ltd -
please direct inquiries about licensing to
[licensing@alces-flight.com](mailto:licensing@alces-flight.com).

Flight Console API is distributed in the hope that it will be
useful, but WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, EITHER
EXPRESS OR IMPLIED INCLUDING, WITHOUT LIMITATION, ANY WARRANTIES OR
CONDITIONS OF TITLE, NON-INFRINGEMENT, MERCHANTABILITY OR FITNESS FOR
A PARTICULAR PURPOSE. See the [Eclipse Public License 2.0](https://opensource.org/licenses/EPL-2.0) for more
details.
