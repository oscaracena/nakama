#!/usr/bin/env python

import mido
from argparse import ArgumentParser, ArgumentTypeError


# This script opens the first MIDI output port and sends a Note-On event for the
# first 16 notes, with inceasing velocity from 0 to 15.


class ColorTester:
    def __init__(self, args):
        self.args = args

        print("Available MIDI output ports:")
        for port in mido.get_output_names():
            print(port)

        self.port = mido.open_output(mido.get_output_names()[0])

    def __del__(self):
        self.port.close()

    def run(self):
        color = self.args.color_offset
        for note in range(self.args.note_offset, self.args.note_offset + 16):
            msg = mido.Message('note_on', note=note, velocity=color, channel=self.args.channel)
            self.port.send(msg)
            color += 1


if __name__ == "__main__":
    def channel_num(value):
        ivalue = int(value)
        if ivalue < 0 or ivalue > 15:
            raise ArgumentTypeError("Channel must be between 0 and 15")
        return ivalue

    def midi_value(value):
        ivalue = int(value)
        if ivalue < 0 or ivalue > 127:
            raise ArgumentTypeError("Value must be between 0 and 127")
        return ivalue

    parser = ArgumentParser()
    parser.add_argument('-c', '--channel', type=channel_num, default=0,
        help='MIDI channel to send messages to (0-15)')
    parser.add_argument('-n', '--note-offset', type=midi_value, default=0,
        help='Starting note (default: 0)')
    parser.add_argument('-o', '--color-offset', type=midi_value, default=0,
        help='Starting color index (default: 0)')

    args = parser.parse_args()
    try:
        tester = ColorTester(args)
        tester.run()
    except KeyboardInterrupt:
        pass
