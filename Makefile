PHONY := sc-implement

sc-implement:
	.sandcastle/node_modules/.bin/tsx .sandcastle/implement/index.mts

sc-build-image:
	.sandcastle/node_modules/.bin/sandcastle docker build-image
