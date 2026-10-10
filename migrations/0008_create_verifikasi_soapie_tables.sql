CREATE TABLE IF NOT EXISTS `verifikasi_pemeriksaan_ralan` (
  `no_rawat` varchar(17) NOT NULL,
  `tgl_perawatan` date NOT NULL,
  `jam_rawat` time NOT NULL,
  `kd_dokter` varchar(20) NOT NULL,
  `tgl_verifikasi` date NOT NULL,
  `jam_verifikasi` time NOT NULL,
  `catatan` text DEFAULT NULL,
  PRIMARY KEY (`no_rawat`, `tgl_perawatan`, `jam_rawat`),
  KEY `kd_dokter` (`kd_dokter`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1;

CREATE TABLE IF NOT EXISTS `verifikasi_pemeriksaan_ranap` (
  `no_rawat` varchar(17) NOT NULL,
  `tgl_perawatan` date NOT NULL,
  `jam_rawat` time NOT NULL,
  `kd_dokter` varchar(20) NOT NULL,
  `tgl_verifikasi` date NOT NULL,
  `jam_verifikasi` time NOT NULL,
  `catatan` text DEFAULT NULL,
  PRIMARY KEY (`no_rawat`, `tgl_perawatan`, `jam_rawat`),
  KEY `kd_dokter` (`kd_dokter`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1;
