# Fedora packaging for Gimlet Eye.
#
# The version is checked against Cargo.toml by scripts/check-packaging.sh.
Name:           gimlet-eye-toolkit
Version:        0.7.0
Release:        1%{?dist}
Summary:        Local workbench for system, crypto, and metadata tasks
License:        MIT
URL:            https://github.com/James-HoneyBadger/GimletEye
Source0:        %{url}/archive/v%{version}/%{name}-%{version}.tar.gz
BuildRequires:  cargo
BuildRequires:  rust
# The unit suite needs only the toolchain; it runs in CI, not here, so that a
# package build stays a build.
%global __cargo_skip_test 1
Recommends:     perl
Recommends:     gnupg
Requires:       glibc

%description
One tool registry, one report format, one configuration file, one audit trail,
and one interface for system administration, file encryption and signing, and
metadata removal.

Everything runs locally: no network calls, no telemetry, no auto-update. The HTTP
API binds loopback only and requires a per-installation token.

%prep
%autosetup -n %{name}-%{version}

%build
export CARGO_INCREMENTAL=0
export RUSTFLAGS="--remap-path-prefix=%{_builddir}/%{name}-%{version}=."
cargo build --release --locked -p gimlet-eye-cli

%install
install -Dm755 target/release/gimlet %{buildroot}%{_bindir}/gimlet
install -Dm644 LICENSE %{buildroot}%{_licensedir}/%{name}/LICENSE
install -Dm644 README.md %{buildroot}%{_docdir}/%{name}/README.md
install -Dm644 CHANGELOG.md %{buildroot}%{_docdir}/%{name}/CHANGELOG.md
install -Dm644 docs/CONTAINER.md %{buildroot}%{_docdir}/%{name}/CONTAINER.md
install -Dm644 docs/PLUGIN_SDK.md %{buildroot}%{_docdir}/%{name}/PLUGIN_SDK.md

%files
%{_bindir}/gimlet
%license LICENSE
%doc README.md CHANGELOG.md docs/CONTAINER.md docs/PLUGIN_SDK.md

%changelog
* Sun Oct 26 2026 Gimlet Eye maintainers <maintainers@example.invalid> - 0.7.0-1
- Local API token, pack conformance and trust, golden corpus, live-engine tests,
  reproducible builds, packaging, and the user and admin guides
