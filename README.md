# Flight Console WebAPI

A web API to provide browser access to an interactive terminal console.

## Overview

Flight Console WebAPI is a web API that in conjunction with [Flight Console
Webapp](https://github.com/openflighthpc/flight-console-webapp) provides
browser access to an interactive terminal console session within HPC
environments.

## Installation

### From source

Flight Console WebAPI requires a recent version of Node and `yarn`.

The following will install from source using `git`:

```
git clone https://github.com/alces-flight/flight-console-webapi.git
cd flight-console-webapi
yarn install
yarn run build
```

XXX TBC.

### Installing with Flight Runway

XXX TBC.

Flight Runway provides a Ruby environment and command-line helpers for
running openflightHPC tools.  Flight Console WebAPI integrates with Flight
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
    
 * Install the `flight-console-webapi` RPM:

    ```
    [root@myhost ~]# yum install flight-console-webapi
    ```

 * Enable HTTPs support

    Flight Console WebAPI is designed to operate over HTTPs connections.  You
    can enable HTTPs with self-signed certificates by running the commands
    below.  You will be asked to enter a passphrase and to answer some
    questions about your organization.

    ```
    [root@myhost ~]# flight www enable-https
    ```

 * Configure details about your cluster

    Flight Console WebAPI needs to be configured with some details about the
    cluster it is providing access to.  This can be done with the `flight
    service configure` command as described below.  You will be asked to
    provide values for:

    **Cluster name**: set it to a string that identifies this cluster in a
    human friendly way.

    **Cluster description**: set it to a string that describes this cluster in
    a human friendly way.

    **Cluster logo URL**: Optionally, set it to the URL for a logo for this
    cluster.  Or leave it unset.

    **Hostname or IP address**: set this to either the fully qualified
    hostname for your server or its IP address.  If using the hostname, make
    sure that it can be resolved correctly.

    Once you have values for the above, you can configure the webapp by running:

    ```
    [root@myhost ~]# flight service configure console-webapi
    ```


## Configuration

XXX TBC

## Operation

Open your browser and visit the URL for your cluster with path `/console`.
E.g., if you have installed on a machine called `my.cluster.com` visit the URL
https://my.cluster.com/console.

Enter your username and password for the cluster.  You will then have access
to a terminal session running on your cluster.

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

Flight Console WebAPI is distributed in the hope that it will be
useful, but WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, EITHER
EXPRESS OR IMPLIED INCLUDING, WITHOUT LIMITATION, ANY WARRANTIES OR
CONDITIONS OF TITLE, NON-INFRINGEMENT, MERCHANTABILITY OR FITNESS FOR
A PARTICULAR PURPOSE. See the [Eclipse Public License 2.0](https://opensource.org/licenses/EPL-2.0) for more
details.
