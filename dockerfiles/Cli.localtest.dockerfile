FROM node:14-stretch-slim
RUN apt update
RUN apt install -y git make musl-dev golang-go sqlite g++ tmux curl jq
RUN mkdir -p /usr/share/man/man1
RUN mkdir -p /usr/share/man/man7
RUN apt install -y netcat

# Configure Go
ENV GOROOT /usr/lib/go
ENV GOPATH /go
ENV PATH /go/bin:$PATH

RUN mkdir -p ${GOPATH}/src ${GOPATH}/bin

# Install Gotty (it needs go >= 1.9)
RUN go get golang.org/dl/go1.10.7
RUN go1.10.7 download
RUN go1.10.7 get github.com/yudai/gotty

RUN apt install -y python
# Install Lerna & gyp
RUN npm install -g node-gyp-build
RUN npm install -g lerna
RUN ln -s "$(which nodejs)" /usr/bin/node
WORKDIR /proj

EXPOSE 8888
