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
BuildRequires:  nodejs >= 20
BuildRequires:  npm
# The unit suite needs only the toolchain; it runs in CI, not here, so that a
# package build stays a build.
%global __cargo_skip_test 1
Recommends:     gnupg
Requires:       glibc
Requires:       nodejs >= 20

%description
One tool registry, one report format, one configuration file, one audit trail,
and one interface for system administration, file encryption and signing, and
metadata removal.

Everything runs locally: no network calls, no telemetry, no auto-update. The
package contains the command line and the engine it spawns; the desktop app is
packaged separately.

%prep
%autosetup -n %{name}-%{version}

%build
export CARGO_INCREMENTAL=0
export RUSTFLAGS="--remap-path-prefix=%{_builddir}/%{name}-%{version}=."
cargo build --release --locked -p gimlet-eye-sidecar
npm ci
npm run build

%install
install -Dm755 target/release/gimlet-sidecar %{buildroot}%{_libdir}/gimlet/gimlet-sidecar
cp -r packages/core/dist %{buildroot}%{_libdir}/gimlet/core
cp -r packages/cli/dist %{buildroot}%{_libdir}/gimlet/cli
cp -r packages/cli/bin %{buildroot}%{_libdir}/gimlet/bin
mkdir -p %{buildroot}%{_libdir}/gimlet/node_modules/@gimlet-eye
cp -r node_modules/smol-toml %{buildroot}%{_libdir}/gimlet/node_modules/
ln -s ../../core %{buildroot}%{_libdir}/gimlet/node_modules/@gimlet-eye/core
mkdir -p %{buildroot}%{_bindir}
ln -s ../lib64/gimlet/bin/gimlet %{buildroot}%{_bindir}/gimlet
install -Dm644 LICENSE %{buildroot}%{_licensedir}/%{name}/LICENSE
install -Dm644 README.md %{buildroot}%{_docdir}/%{name}/README.md
install -Dm644 CHANGELOG.md %{buildroot}%{_docdir}/%{name}/CHANGELOG.md
install -Dm644 docs/CONTAINER.md %{buildroot}%{_docdir}/%{name}/CONTAINER.md
install -Dm644 docs/COMPATIBILITY.md %{buildroot}%{_docdir}/%{name}/COMPATIBILITY.md

%files
%{_bindir}/gimlet
%{_libdir}/gimlet
%license LICENSE
%doc README.md CHANGELOG.md docs/CONTAINER.md docs/COMPATIBILITY.md

%changelog
* Sun Oct 26 2026 Gimlet Eye maintainers <maintainers@example.invalid> - 0.7.0-1
- TypeScript surfaces over one Rust engine: the desktop app and the CLI share
  their implementation, the HTTP API and the pack protocol are gone
