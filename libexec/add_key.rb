#!/usr/bin/env ruby

require 'etc'
require 'fileutils'

case ARGV.length
when 0
  raise "Missing the USER and KEY arguments"
when 1
  raise "Missing the KEY argument"
end

# Extract the arguments and get the user's details
USER = ARGV[0]
KEY = ARGV[1]
PASSWD = Etc.getpwnam(USER)

# Become the user
Process.groups = []
Process.gid = PASSWD.gid
Process.egid = PASSWD.gid
Process.initgroups(USER, PASSWD.gid)
Process.uid = PASSWD.uid
Process.euid = PASSWD.uid
Process.setsid
ENV['HOME'] = PASSWD.dir
ENV['USER'] = USER
ENV['LOGNAME'] = USER

# Ensure the .ssh directory exists
DIR = File.expand_path '~/.ssh'
$stderr.puts DIR
$stderr.puts File.exists? DIR
FileUtils.mkdir(DIR, mode: 0700) unless Dir.exists? DIR

# Ensure authorized_keys exists
PATH = File.expand_path('~/.ssh/authorized_keys')
unless File.exists? PATH
  FileUtils.touch PATH
  FileUtils.chmod 0600, PATH
end

# Add the key
File.open(PATH, 'r+') do |file|
  # Exit early if the key already exists
  file.each_line do |line|
    next unless line == KEY
    puts "Your authorized_keys have not been changed"
    exit 0
  end

  # Ensure the "current" last character is "\n"
  begin
    file.seek(-1, :END)
    char = file.read
    file.write("\n") unless char[-1] == "\n"
  rescue Errno::EINVAL
    # NOOP - Empty files cannot seek to the -1 position
    #        This is to be expected and can be ignored
  end

  # Add the key
  file.puts KEY
end

# Exit cleanly
puts "Updated your authorized_keys"
exit 0
