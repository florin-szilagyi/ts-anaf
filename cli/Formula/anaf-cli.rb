# typed: false
# frozen_string_literal: true

# Source formula for the standalone `anaf-cli` Homebrew tap.
#
# This file is published to `florin-szilagyi/homebrew-anaf-cli` as
# `Formula/anaf-cli.rb`. The SHA256 placeholders are replaced by the CI
# release pipeline on every tagged release of the CLI.
#
# Install:
#   brew tap florin-szilagyi/anaf
#   brew install anaf-cli
class AnafCli < Formula
  desc "CLI for the Romanian ANAF e-Factura SDK (anaf-ts-sdk)"
  homepage "https://github.com/florin-szilagyi/efactura-anaf-ts-sdk"
  license "MIT"
  version "0.1.0-preview.1"

  on_macos do
    on_arm do
      url "https://github.com/florin-szilagyi/efactura-anaf-ts-sdk/releases/download/cli-v#{version}/anaf-cli-#{version}-darwin-arm64.tar.gz"
      sha256 "REPLACE_WITH_DARWIN_ARM64_SHA256"
    end

    on_intel do
      url "https://github.com/florin-szilagyi/efactura-anaf-ts-sdk/releases/download/cli-v#{version}/anaf-cli-#{version}-darwin-x64.tar.gz"
      sha256 "REPLACE_WITH_DARWIN_X64_SHA256"
    end
  end

  on_linux do
    on_intel do
      url "https://github.com/florin-szilagyi/efactura-anaf-ts-sdk/releases/download/cli-v#{version}/anaf-cli-#{version}-linux-x64.tar.gz"
      sha256 "REPLACE_WITH_LINUX_X64_SHA256"
    end
  end

  def install
    bin.install "anaf-cli"
  end

  test do
    # Verify the binary reports its version, matches the formula version,
    # and can print a manifest JSON Schema (exercises the full bundle).
    assert_match version.to_s, shell_output("#{bin}/anaf-cli --version")
    schema = shell_output("#{bin}/anaf-cli schema print UblBuild")
    assert_match(/"\\$schema"/, schema)
  end
end
