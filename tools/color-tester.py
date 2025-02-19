#!/usr/bin/env python

import mido
from argparse import ArgumentParser, ArgumentTypeError


# This script opens the first MIDI output port and sends events to control its LED
# feedback. Use --help for more info about possible options.

class ColorTester:
    def __init__(self, args):
        self.args = args

        print("Available MIDI output ports:")
        for port in mido.get_output_names():
            print(f"- {port}")

        self.port = mido.open_output(mido.get_output_names()[0])

    def __del__(self):
        self.port.close()

    def run(self):
        print(f"Sending {self.args.event_amount} event(s)...")
        if self.args.effect != -1:
            self._send_effects()
        else:
            self._send_colors()

    def _send_colors(self):
        event = 'note_off' if self.args.clear else "note_on"
        color = self.args.color_offset
        start = self.args.note_offset
        end = self.args.note_offset + self.args.event_amount
        for note in range(start, end):
            msg = mido.Message(event, note=note, velocity=color, channel=self.args.channel)
            self.port.send(msg)
            color += 1

    def _send_effects(self):
        event = "control_change"
        effect = self.args.effect << 4 | self.args.amount
        start = self.args.note_offset
        end = self.args.note_offset + self.args.event_amount
        for control in range(start, end):
            msg = mido.Message(event, control=control, value=effect, channel=self.args.channel)
            self.port.send(msg)
            effect += 1


if __name__ == "__main__":
    def clamp(value, min, max):
        try:
            ivalue = int(value)
        except (TypeError, ValueError):
            raise ArgumentTypeError(f"invalid int value: '{value}'")
        if ivalue < min or ivalue > max:
            raise ArgumentTypeError(f"invalid value, must be between {min} and {max}")
        return ivalue

    parser = ArgumentParser()
    parser.add_argument('-l', '--channel', type=lambda v: clamp(v, 0, 15), default=0,
        help='MIDI channel to send messages to (0-15)')
    parser.add_argument('-n', '--note-offset', type=lambda v: clamp(v, 0, 127), default=0,
        help='Starting note (default: 0)')
    parser.add_argument('-c', '--color-offset', type=lambda v: clamp(v, 0, 127), default=0,
        help='Starting color index (default: 0)')
    parser.add_argument('-e', '--event-amount', type=int, default=23,
        help='Number of events to send (default: 16)')
    parser.add_argument('-r', '--clear', action="store_true",
        help='Send a Note-Off event, to clear color')

    parser.add_argument('-f', '--effect', type=lambda v: clamp(v, 0, 2), default=-1,
        help='Send a CC event for the given effect')
    parser.add_argument('-m', '--amount', type=lambda v: clamp(v, 0, 15), default=0,
        help='Sets the effect param (amount of effect)')

    args = parser.parse_args()
    try:
        tester = ColorTester(args)
        tester.run()
    except KeyboardInterrupt:
        pass
