include .project-settings.env

REPO_PREFIX ?= github.com/hyp3rd/hypercache-monitor
PROTO_ENABLED ?= true

# check_command_exists is a helper function that checks if a command exists.
define check_command_exists
@which $(1) > /dev/null 2>&1 || (echo "$(1) command not found" && exit 1)
endef

ifeq ($(call check_command_exists,$(1)),false)
  $(error "$(1) command not found")
endif

# help prints a list of available targets and their descriptions.
help:
	@echo "Available targets:"
	@echo
	@echo "Development commands:"
	@echo
	@echo "For more information, see the project README."

.PHONY: help
