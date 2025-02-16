APP_NAME  = nakama
PORT      = 5100


all:

run:
	@echo Open the site @ http://127.0.0.1:$(PORT)
	python3 -m http.server --directory docs --bind 0.0.0.0 $(PORT)

run-https:
	@echo "Open https://127.0.0.1:$(PORT)"
	@twistd -no web --https=$(PORT) --path=docs \
		-c certs/$(APP_NAME).crt -k certs/$(APP_NAME).key

run-rtpmidid-service:
	rtpmidid

run-jacknetumpd-service:
	jacknetumpd

load-virtual-midi:
	@echo '> NOTE: this is for ALSA <-> OSS only (i.e /dev/midi0)!'
	@echo '> For a virtual ALSA <-> Jack device, use a "Midi Through Port"'
	@echo '> with "a2jmidi_bridge" or "a2jmidid" for better performance'
	sudo modprobe snd_virmidi midi_devs=1

unload-virtual-midi:
	sudo rmmod snd_virmidi

run-a2j-bridge:
	a2jmidi_bridge

install-local-https-webserver:
	pip install twisted[tls]

deploy:
	git push origin main:deploy -f
	xdg-open https://github.com/oscaracena/nakama/deployments
