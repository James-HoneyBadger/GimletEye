#!/usr/bin/env perl
# ============================================================================
# Gimlet Eye pack adapter for Perl Den.
#
# Speaks the Gimlet Eye JSON-RPC protocol on stdin/stdout (one object per line).
# Perl Den's own module contract -- run(%args) -> \%result plus
# format_report(\%result) -> $string -- is preserved, so the 20 existing scripts
# join the toolkit without being rewritten.
#
# Set GIMLET_PERLDEN_HOME to point at a Perl Den checkout. Otherwise the pack
# searches external/Perl_Den next to the toolkit sources, then ~/Perl_Den.
# ============================================================================
use strict;
use warnings;

use Encode ();
use File::Basename qw(basename dirname);
use File::Spec;
use JSON::PP ();
use Time::HiRes ();

my $PROTOCOL_VERSION = 1;
my $PACK_VERSION     = '0.1.0';
my $JSON             = JSON::PP->new->utf8->canonical;

binmode(STDIN,  ':raw');
binmode(STDOUT, ':raw');
$| = 1;

my $ROOT = find_perlden_root();
my ($TOOLS, $BY_ID) = $ROOT ? load_tools($ROOT) : ([], {});

warn "perlden-pack: Perl Den checkout not found; exposing 0 tools\n" unless $ROOT;

while (my $line = <STDIN>) {
    next unless $line =~ /\S/;

    my $request = eval { $JSON->decode($line) };
    if (!$request || ref $request ne 'HASH') {
        print_error(undef, -32700, 'parse error');
        next;
    }

    my $id     = $request->{id};
    my $method = $request->{method} // '';
    my $params = $request->{params};

    if ($method eq 'initialize') {
        my $client_version = ref $params eq 'HASH' ? $params->{protocol_version} : undef;
        if (defined $client_version && $client_version != $PROTOCOL_VERSION) {
            print_error($id, -32600, "unsupported protocol version $client_version");
            next;
        }
        print_result($id, {
            protocol_version => $PROTOCOL_VERSION,
            name             => 'perlden',
            version          => $PACK_VERSION,
            capabilities     => ['run', 'list_tools'],
        });
        next;
    }

    if ($method eq 'list_tools') {
        print_result($id, { tools => $TOOLS });
        next;
    }

    if ($method eq 'run_tool') {
        # The code matters: -32001 means "no such tool" and everything else is an
        # execution failure. Collapsing them sent a caller looking at its own
        # arguments when the real problem was a stale tool id.
        my ($result, $error, $code) = run_tool(ref $params eq 'HASH' ? $params : {});
        if (defined $error) {
            print_error($id, $code // -32003, $error);
        } else {
            print_result($id, $result);
        }
        next;
    }

    if ($method eq 'shutdown') {
        print_result($id, {});
        last;
    }

    print_error($id, -32601, "unknown method '$method'");
}

exit 0;

# ---------------------------------------------------------------------------

sub find_perlden_root {
    my @candidates;
    push @candidates, $ENV{GIMLET_PERLDEN_HOME} if $ENV{GIMLET_PERLDEN_HOME};

    my $pack_dir = $ENV{GIMLET_PACK_DIR};
    if (defined $pack_dir && length $pack_dir) {
        # The host starts the pack inside its own directory, so a relative pack
        # dir must be anchored before walking up to the toolkit root.
        $pack_dir = File::Spec->rel2abs($pack_dir);
        my $up = File::Spec->updir;
        push @candidates,
            File::Spec->catdir($pack_dir, $up, $up, 'external', 'Perl_Den'),
            File::Spec->catdir($pack_dir, $up, $up, $up, 'Perl_Den');
    }

    if (defined $ENV{HOME} && length $ENV{HOME}) {
        push @candidates,
            File::Spec->catdir($ENV{HOME}, 'Perl_Den'),
            File::Spec->catdir($ENV{HOME}, 'PerlDen'),
            File::Spec->catdir($ENV{HOME}, 'src', 'Perl_Den');
    }

    for my $dir (@candidates) {
        next unless defined $dir && length $dir;
        my $scripts = File::Spec->catdir($dir, 'lib', 'PerlDen', 'Scripts');
        return File::Spec->rel2abs($dir) if -d $scripts;
    }
    return undef;
}

sub load_tools {
    my ($root) = @_;
    my $scripts_dir = File::Spec->catdir($root, 'lib', 'PerlDen', 'Scripts');
    my @list;
    my %by_id;

    for my $file (sort glob(File::Spec->catfile($scripts_dir, '*.pm'))) {
        my $module = basename($file, '.pm');
        next if $module eq 'Base';    # reserved for a future shared base class

        my $id      = 'perlden.' . to_kebab($module);
        my $package = "PerlDen::Scripts::$module";

        $by_id{$id} = {
            module => $package,
            file   => $file,
            name   => $module,
        };

        push @list, {
            id           => $id,
            title        => to_title($module),
            summary      => normalize_text(summary_from_file($file)) || "Perl Den module $module",
            category     => 'sysadmin',
            capabilities => ['fs:read', 'process:exec', 'system'],
            args         => [],
            tags         => ['perlden', 'sysadmin'],
            origin       => 'plugin:perlden',
            version      => $PACK_VERSION,
        };
    }

    return (\@list, \%by_id);
}

sub run_tool {
    my ($params) = @_;
    my $tool_id = $params->{tool} // '';
    my $entry   = $BY_ID->{$tool_id};

    return (undef, "unknown tool '$tool_id'", -32001) unless $entry;

    my $args = $params->{args};
    $args = {} unless ref $args eq 'HASH';

    unshift @INC, File::Spec->catdir($ROOT, 'lib');

    my $loaded = eval { require $entry->{file}; 1 };
    return (undef, "cannot load $entry->{module}: $@") unless $loaded;

    my $run = $entry->{module}->can('run');
    return (undef, "$entry->{module} has no run()") unless $run;

    my $started = Time::HiRes::time();
    my $result  = eval { $run->(%$args) };
    my $elapsed = int((Time::HiRes::time() - $started) * 1000);

    if (my $error = $@) {
        chomp $error;
        return (undef, "execution failed: $error");
    }

    my $report_text = '';
    if (my $format = $entry->{module}->can('format_report')) {
        $report_text = normalize_text(eval { $format->($result) } // '');
    }
    $result = normalize_deep($result);

    my $status   = 'ok';
    my @findings;

    if (ref $result eq 'HASH' && defined $result->{error} && !ref $result->{error}) {
        $status = 'error';
        push @findings, {
            severity => 'high',
            code     => 'perlden.error',
            message  => "$result->{error}",
        };
    }

    my $summary = first_line($report_text) || "ran $tool_id";
    $summary = substr($summary, 0, 160) . '...' if length $summary > 160;

    return ({
        tool        => $tool_id,
        status      => $status,
        summary     => $summary,
        findings    => \@findings,
        data        => { result => $result },
        body        => $report_text,
        warnings    => [],
        duration_ms => $elapsed,
    }, undef);
}

# ---------------------------------------------------------------------------

# Perl Den modules are UTF-8 sources that never declare `use utf8`, so their
# string literals arrive as Latin-1 code points. Reinterpreting valid UTF-8 byte
# sequences here is what keeps box drawing and emoji intact on the wire.
sub normalize_text {
    my $text = shift;
    return '' unless defined $text;
    return $text if ref $text;
    return $text if utf8::is_utf8($text);
    my $copy = $text;
    return utf8::decode($copy) ? $copy : $text;
}

sub normalize_deep {
    my $value = shift;
    return $value unless defined $value;
    my $kind = ref $value;
    if ($kind eq 'HASH') {
        return { map { $_ => normalize_deep($value->{$_}) } keys %$value };
    }
    if ($kind eq 'ARRAY') {
        return [ map { normalize_deep($_) } @$value ];
    }
    return $value if $kind;
    return normalize_text($value);
}

sub to_kebab {
    my $name = shift;
    $name =~ s/([A-Z]+)([A-Z][a-z])/$1-$2/g;
    $name =~ s/([a-z0-9])([A-Z])/$1-$2/g;
    return lc $name;
}

sub to_title {
    my $kebab = to_kebab(shift);
    my @words = split /-/, $kebab;
    return join ' ', map { ucfirst } @words;
}

sub summary_from_file {
    my $path = shift;
    open my $handle, '<', $path or return '';
    my @head;
    while (my $line = <$handle>) {
        push @head, $line;
        last if @head >= 40;
    }
    close $handle;

    my $in_banner = 0;
    for my $line (@head) {
        if ($line =~ /^#\s*={4,}/) {
            $in_banner = 1;
            next;
        }
        next unless $in_banner;
        next if $line =~ /^#\s*={4,}/;
        return $1 if $line =~ /^#\s*(.+?)\s*$/;
        last;
    }
    return '';
}

sub first_line {
    my $text = shift // '';
    for my $line (split /\n/, $text) {
        $line =~ s/[\x{2500}-\x{257F}]//g;    # box drawing
        $line =~ s/^\s+|\s+$//g;
        next unless length $line >= 3;
        next unless $line =~ /[A-Za-z0-9]/;
        return $line;
    }
    return '';
}

sub print_result {
    my ($id, $result) = @_;
    my $encoded = eval { $JSON->encode({ jsonrpc => '2.0', id => $id, result => $result }) };
    if (!defined $encoded) {
        print_error($id, -32603, 'cannot encode result');
        return;
    }
    print $encoded, "\n";
}

sub print_error {
    my ($id, $code, $message) = @_;
    print $JSON->encode({
        jsonrpc => '2.0',
        id      => $id,
        error   => { code => $code, message => $message },
    }), "\n";
}
